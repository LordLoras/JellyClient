import { EventEmitter } from 'node:events';
import type { ClientEvent } from '@shared/contracts.js';

export class ClientEventBus extends EventEmitter {
  emitClient(event: ClientEvent): void {
    this.emit('client-event', event);
  }

  onClient(listener: (event: ClientEvent) => void): () => void {
    this.on('client-event', listener);
    return () => this.off('client-event', listener);
  }
}
