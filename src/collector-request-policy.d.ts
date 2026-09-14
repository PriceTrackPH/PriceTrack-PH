export type CollectorRetryPolicy = { attempts?: number; delays?: number[] };
export declare function withCollectorRetry<T>(operation: () => Promise<T>, policy?: CollectorRetryPolicy): Promise<T>;
