declare module '@alicloud/log' {
  interface Credentials {
    accessKeyId: string;
    accessKeySecret: string;
    securityToken?: string;
  }

  interface ClientConfig {
    accessKeyId?: string;
    accessKeySecret?: string;
    securityToken?: string;
    credentialsProvider?: {
      getCredentials(): Promise<Credentials>;
    };
    endpoint?: string;
    region?: string;
    net?: string;
    use_https?: boolean;
    userAgent?: string;
  }

  interface LogRecord {
    timestamp: number;
    timestampNsPart?: number;
    content: Record<string, string>;
  }

  interface PostLogStoreLogsData {
    logs: LogRecord[];
    tags?: Array<Record<string, string>>;
    topic?: string;
    source?: string;
  }

  class Client {
    constructor(config: ClientConfig);
    postLogStoreLogs(
      projectName: string,
      logstoreName: string,
      data: PostLogStoreLogsData,
      options?: Record<string, unknown>,
    ): Promise<unknown>;
  }

  export = Client;
}
