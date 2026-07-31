import { Waves } from 'lucide-react';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand${compact ? ' brand--compact' : ''}`}>
      <span className="brand__mark" aria-hidden="true">
        <Waves strokeWidth={2.5} />
      </span>
      <span className="brand__word">
        Jelly<span>Client</span>
      </span>
      {!compact && <span className="brand__edition">JELLYFIN CLIENT</span>}
    </div>
  );
}
