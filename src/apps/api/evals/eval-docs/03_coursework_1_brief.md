# Coursework 1 Brief - Retrieval Prototype

## Context
Coursework 1 belongs to CSC4042 Intelligent Information Systems. It focuses on building a small retrieval prototype over a controlled document collection.

## Weighting and timing
- Weighting: 30 percent of the module mark
- Released: Monday 21 September 2026
- Due: Friday 23 October 2026 at 16:00
- Feedback return target: Friday 6 November 2026

## Submission requirements
Students must submit one ZIP archive named `studentnumber_csc4042.zip` containing:
- source code
- a short technical report in PDF format
- a README with setup steps
- a sample query file with at least 10 example queries

## Project task
Students must implement a retrieval system that:
- indexes the supplied source pack
- supports semantic retrieval
- returns the top 5 passages for each query
- logs query latency in milliseconds
- includes a short explanation of chunking strategy

## Technical constraints
- Python 3.11 must be used.
- Students may use FAISS, pgvector, or another vector index approved by the lecturer.
- The submission must run locally on a standard lab machine without paid external services.

## Marking rubric
- 35 percent: retrieval quality and ranking rationale
- 25 percent: code quality and reproducibility
- 20 percent: evaluation methodology
- 20 percent: report clarity

## Academic integrity
- Students may discuss high-level ideas in groups.
- Students must not share code, reports, or write-ups.
- Any external libraries or AI assistance used must be declared in the README.

## Late penalties
- Up to 24 hours late: capped at 50 percent
- More than 24 hours late: mark of zero
- Approved extensions override the standard late penalty

## Clarifications
- Students do not need to build a full web interface.
- The sample query file may be plain text or JSON.
- The technical report should be 1200 to 1500 words.
