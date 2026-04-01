import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';

export interface WebhookRouteRegistration {
  routeId: string;
  host: string;
  port: number;
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}

interface WebhookRouteEntry {
  routeId: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}

interface WebhookEndpointEntry {
  server: Server;
  routes: Map<string, WebhookRouteEntry>;
}

const HttpStatusCode = {
  NotFound: 404,
  InternalServerError: 500,
} as const;

export class WebhookHub {
  private readonly endpoints = new Map<string, WebhookEndpointEntry>();
  private readonly routeToEndpoint = new Map<string, string>();
  private readonly routeToPath = new Map<string, string>();

  async registerRoute(registration: WebhookRouteRegistration): Promise<void> {
    const normalizedPath = this.normalizePath(registration.path);
    const endpointKey = this.buildEndpointKey(registration.host, registration.port);

    if (this.routeToEndpoint.has(registration.routeId)) {
      await this.unregisterRoute(registration.routeId);
    }

    let endpoint = this.endpoints.get(endpointKey);
    if (!endpoint) {
      const routes = new Map<string, WebhookRouteEntry>();
      const server = createServer((req, res) => {
        this.dispatchRequest(endpointKey, req, res).catch((error) => {
          console.error('[WebhookHub] request dispatch failed:', error);
          if (!res.writableEnded) {
            res.statusCode = HttpStatusCode.InternalServerError;
            res.end('Internal Server Error');
          }
        });
      });

      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(registration.port, registration.host, () => {
          server.removeListener('error', reject);
          resolve();
        });
      });

      endpoint = { server, routes };
      this.endpoints.set(endpointKey, endpoint);
      console.log(`[WebhookHub] started endpoint ${endpointKey}`);
    }

    const occupied = endpoint.routes.get(normalizedPath);
    if (occupied && occupied.routeId !== registration.routeId) {
      throw new Error(
        `Webhook path conflict on ${endpointKey}${normalizedPath}: owned by ${occupied.routeId}`,
      );
    }

    endpoint.routes.set(normalizedPath, {
      routeId: registration.routeId,
      handler: registration.handler,
    });
    this.routeToEndpoint.set(registration.routeId, endpointKey);
    this.routeToPath.set(registration.routeId, normalizedPath);
    console.log(`[WebhookHub] registered route ${registration.routeId} -> ${endpointKey}${normalizedPath}`);
  }

  async unregisterRoute(routeId: string): Promise<boolean> {
    const endpointKey = this.routeToEndpoint.get(routeId);
    const path = this.routeToPath.get(routeId);
    if (!endpointKey || !path) {
      return false;
    }
    const endpoint = this.endpoints.get(endpointKey);
    if (!endpoint) {
      this.routeToEndpoint.delete(routeId);
      this.routeToPath.delete(routeId);
      return false;
    }

    endpoint.routes.delete(path);
    this.routeToEndpoint.delete(routeId);
    this.routeToPath.delete(routeId);
    console.log(`[WebhookHub] unregistered route ${routeId} from ${endpointKey}${path}`);

    if (endpoint.routes.size === 0) {
      await this.stopEndpoint(endpointKey, endpoint);
    }
    return true;
  }

  async stopAll(): Promise<void> {
    const endpointEntries = Array.from(this.endpoints.entries());
    for (const [endpointKey, endpoint] of endpointEntries) {
      await this.stopEndpoint(endpointKey, endpoint);
    }
    this.routeToEndpoint.clear();
    this.routeToPath.clear();
  }

  private async dispatchRequest(
    endpointKey: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const endpoint = this.endpoints.get(endpointKey);
    if (!endpoint) {
      res.statusCode = HttpStatusCode.NotFound;
      res.end('Not Found');
      return;
    }

    const reqUrl = req.url || '/';
    const url = new URL(reqUrl, `http://${req.headers.host || '127.0.0.1'}`);
    const entry = endpoint.routes.get(this.normalizePath(url.pathname));
    if (!entry) {
      res.statusCode = HttpStatusCode.NotFound;
      res.end('Not Found');
      return;
    }

    await entry.handler(req, res);
  }

  private async stopEndpoint(endpointKey: string, endpoint: WebhookEndpointEntry): Promise<void> {
    await new Promise<void>((resolve) => {
      endpoint.server.close((error) => {
        if (error) {
          console.warn(`[WebhookHub] failed to stop endpoint ${endpointKey}:`, error);
        }
        resolve();
      });
    });
    this.endpoints.delete(endpointKey);
    console.log(`[WebhookHub] stopped endpoint ${endpointKey}`);
  }

  private buildEndpointKey(host: string, port: number): string {
    return `${host}:${port}`;
  }

  private normalizePath(pathValue: string): string {
    const trimmed = pathValue.trim();
    if (!trimmed) {
      return '/';
    }
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  }
}
