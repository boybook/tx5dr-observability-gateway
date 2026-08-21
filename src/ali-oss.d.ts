declare module 'ali-oss' {
  interface OssOptions {
    region: string;
    bucket: string;
    accessKeyId: string;
    accessKeySecret: string;
    stsToken?: string;
    secure?: boolean;
    internal?: boolean;
  }

  interface HeadResult {
    res: {
      headers: Record<string, string | number | undefined>;
    };
  }

  export default class OSS {
    options: OssOptions;
    constructor(options: OssOptions);
    generateObjectUrl(name: string): string;
    signPostObjectPolicyV4(policy: string | object, date: Date): string;
    head(name: string): Promise<HeadResult>;
  }
}
