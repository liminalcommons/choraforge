/**
 * ABOUTME: Status badge component showing evolution engine status.
 * Uses color-coded indicators with animated dots for active states.
 */

import React from 'react';
import type { EvolutionStatus } from '../lib/types.js';

interface Props {
  status: EvolutionStatus;
}

const labels: Record<EvolutionStatus, string> = {
  idle: 'IDLE',
  analyzing: 'ANALYZING',
  spawning: 'SPAWNING',
  scoring: 'SCORING',
  merging: 'MERGING',
  complete: 'COMPLETE',
  stopped: 'STOPPED',
};

export function StatusBadge({ status }: Props): React.ReactElement {
  return (
    <span className={`badge badge-${status}`}>
      <span className={`status-dot ${status}`} />
      {labels[status]}
    </span>
  );
}
