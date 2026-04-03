'use client';

import { useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import type { FlagReason } from '../../lib/types';

interface FlagModalProps {
  label: string;
  onSubmit: (reason: FlagReason, notes?: string) => void;
  onClose: () => void;
  submitting?: boolean;
}

export function FlagModal({ label, onSubmit, onClose, submitting }: FlagModalProps) {
  const [reason, setReason] = useState<FlagReason>('incorrect');
  const [notes, setNotes] = useState('');

  return (
    <div className="modal-backdrop modal-backdrop--raised" onClick={onClose}>
      <div className="gmodal gmodal--sm" onClick={(e) => e.stopPropagation()}>
        <div className="gmodal__header">
          <span className="gmodal__badge">FLAG {label.toUpperCase()}</span>
          <button className="gmodal__icon-btn" type="button" onClick={onClose}>
            <XMarkIcon />
          </button>
        </div>
        <div className="flag-modal__body">
          <div>
            <label className="flag-modal__label">Reason</label>
            <select
              className="flag-modal__select"
              value={reason}
              onChange={(e) => setReason(e.target.value as FlagReason)}
            >
              <option value="incorrect">Incorrect</option>
              <option value="unsupported">Unsupported by sources</option>
              <option value="outdated">Outdated</option>
              <option value="harmful">Harmful</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="flag-modal__label">Notes (optional)</label>
            <textarea
              className="flag-modal__textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Add details about the issue..."
            />
          </div>
          <div className="flag-modal__actions">
            <button className="flag-modal__btn" type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="flag-modal__btn flag-modal__btn--primary"
              type="button"
              disabled={submitting}
              onClick={() => onSubmit(reason, notes || undefined)}
            >
              {submitting ? 'Flagging...' : 'Submit Flag'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
