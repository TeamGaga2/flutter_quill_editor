export interface HostTransport {
  send(message: string): void | Promise<void>;
  subscribe(listener: (message: unknown) => void): () => void;
  destroy(): void;
}
