export type NqCycleState = { recorded: number; lowDone: boolean };
export declare function readNqCycle(storage: Pick<Storage, "getItem">, key: string): NqCycleState;
export declare function nqCycleMode(state: NqCycleState): "low" | "unavailable" | null;
export declare function advanceNqCycle(state: NqCycleState, product: { nqCycleMode?: "low" | "unavailable"; nqCycleFallback?: boolean }): NqCycleState;
