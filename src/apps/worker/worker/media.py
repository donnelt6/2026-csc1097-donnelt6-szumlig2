"""Media transcription helpers for linked YouTube fallback uploads."""

import io
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from openai import OpenAI

from .app import logger, settings

SUPPORTED_MEDIA_EXTENSIONS = {
    ".mp3",
    ".mp4",
    ".m4a",
}

MEDIA_CONTENT_TYPES = {
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".m4a": "audio/mp4",
}


def _media_extension(storage_path: str) -> str:
    return Path(storage_path).suffix.lower()


def _is_supported_media_path(storage_path: str) -> bool:
    return _media_extension(storage_path) in SUPPORTED_MEDIA_EXTENSIONS


def _transcribe_media_bytes(raw: bytes, storage_path: str) -> tuple[str, dict]:
    ext = _media_extension(storage_path)
    if ext not in SUPPORTED_MEDIA_EXTENSIONS:
        raise ValueError("Unsupported media format for transcription")
    if len(raw) > settings.media_upload_max_bytes:
        raise ValueError("Media file exceeds upload size limit")
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY missing in worker environment")
    _validate_transcription_model(settings.transcription_model)

    client = OpenAI(api_key=settings.openai_api_key)
    upload_name, upload_bytes, input_metadata = _prepare_transcription_input(raw, storage_path)
    logger.info(
        "worker.media.transcribe source_path=%s upload_name=%s model=%s mode=%s input_bytes=%s worker_pid=%s",
        storage_path,
        upload_name,
        settings.transcription_model,
        input_metadata.get("transcription_input_mode"),
        input_metadata.get("transcription_input_bytes"),
        os.getpid(),
    )
    upload = io.BytesIO(upload_bytes)
    upload.name = upload_name
    response = client.audio.transcriptions.create(
        file=upload,
        model=settings.transcription_model,
        response_format="text",
    )

    if isinstance(response, str):
        text = response
    else:
        text = getattr(response, "text", "")
    text = text.strip()
    if not text:
        raise ValueError("No transcript text extracted from media upload")
    return text, {
        "transcription_provider": "openai",
        "transcription_model": settings.transcription_model,
        "media_extension": ext.lstrip("."),
        "media_content_type": MEDIA_CONTENT_TYPES.get(ext, "application/octet-stream"),
        **input_metadata,
    }


def _prepare_transcription_input(raw: bytes, storage_path: str) -> tuple[str, bytes, dict]:
    ext = _media_extension(storage_path)
    upload_name = Path(storage_path).name or f"upload{ext}"
    original_bytes = len(raw)
    if original_bytes <= settings.transcription_max_bytes:
        return (
            upload_name,
            raw,
            {
                "original_media_bytes": original_bytes,
                "transcription_input_mode": "direct",
                "transcription_input_extension": ext.lstrip("."),
                "transcription_input_bytes": original_bytes,
            },
        )

    processed_name, processed_bytes = _compress_media_for_transcription(raw, storage_path)
    return (
        processed_name,
        processed_bytes,
        {
            "original_media_bytes": original_bytes,
            "transcription_input_mode": "ffmpeg_preprocessed",
            "transcription_input_extension": Path(processed_name).suffix.lstrip("."),
            "transcription_input_bytes": len(processed_bytes),
        },
    )


def _compress_media_for_transcription(raw: bytes, storage_path: str) -> tuple[str, bytes]:
    ffmpeg_binary = shutil.which(settings.ffmpeg_binary)
    if not ffmpeg_binary:
        raise RuntimeError("FFmpeg is required to transcribe media files above the direct transcription size limit")

    source_path = Path(storage_path)
    source_name = source_path.name or f"upload{_media_extension(storage_path)}"
    with tempfile.TemporaryDirectory(prefix="caddie-media-") as temp_dir:
        temp_dir_path = Path(temp_dir)
        input_path = temp_dir_path / source_name
        input_path.write_bytes(raw)
        output_path = temp_dir_path / f"{source_path.stem or 'upload'}-transcription.mp3"

        for bitrate in ("64k", "32k"):
            _run_ffmpeg_preprocess(ffmpeg_binary, input_path, output_path, bitrate)
            processed = output_path.read_bytes()
            if len(processed) <= settings.transcription_max_bytes:
                return output_path.name, processed

        raise ValueError("Media could not be reduced below the transcription size limit")


def _run_ffmpeg_preprocess(ffmpeg_binary: str, input_path: Path, output_path: Path, bitrate: str) -> None:
    if output_path.exists():
        output_path.unlink()
    try:
        subprocess.run(
            [
                ffmpeg_binary,
                "-y",
                "-i",
                str(input_path),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-b:a",
                bitrate,
                str(output_path),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
    except subprocess.CalledProcessError as exc:
        message = exc.stderr.decode("utf-8", errors="ignore").strip()
        raise RuntimeError(f"FFmpeg failed while preparing media for transcription: {message or exc}") from exc

    if not output_path.exists():
        raise RuntimeError("FFmpeg did not produce a transcription-ready audio file")


def _validate_transcription_model(model: str) -> None:
    normalized = (model or "").strip().lower()
    if not normalized:
        raise RuntimeError("OPENAI transcription model is missing in worker configuration")
    # `whisper-1` remains valid even though newer GPT audio models use the
    # `*-transcribe` naming pattern.
    if normalized != "whisper-1" and "transcribe" not in normalized:
        raise RuntimeError(
            f"Configured transcription model '{model}' is invalid for audio transcription; use whisper-1 or a *-transcribe model"
        )


__all__ = [
    "MEDIA_CONTENT_TYPES",
    "SUPPORTED_MEDIA_EXTENSIONS",
    "_compress_media_for_transcription",
    "_is_supported_media_path",
    "_media_extension",
    "_prepare_transcription_input",
    "_run_ffmpeg_preprocess",
    "_transcribe_media_bytes",
    "_validate_transcription_model",
]
