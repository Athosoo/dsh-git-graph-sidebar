/**
 * Anonymous install telemetry shared by the DSH Web UI family plugins.
 *
 * Once per UTC day per browser, each wired plugin sends one heartbeat to
 * the dsh-market edge API listing its package name (and version when known).
 * The payload carries no conversation data and no identifiers beyond a random
 * UUID generated in localStorage; the server hashes it with a deployment salt
 * before storage and never persists IP addresses. Sends are fire-and-forget:
 * failures stay silent and simply retry on a later mount or day. Frames where
 * storage is unavailable report nothing.
 *
 * The family-wide opt-out and the browser's Do Not Track signal both suppress
 * the heartbeat; the Web Plugins settings switch writes the same localStorage
 * key. The system is documented in docs/telemetry.md.
 */
export type TelemetryChannel = 'market' | 'npm' | 'unknown';
export interface TelemetryItem {
    /** npm package name or asset id, e.g. "@scope/plugin-name" or "skin:harbor". */
    name: string;
    /** Installed version when known; omitted otherwise. */
    version?: string;
    /** Install channel when determinable (market = Workshop install). */
    channel?: TelemetryChannel;
}
/** localStorage key carrying the family-wide telemetry opt-out ('1' = off). */
export declare const TELEMETRY_OPT_OUT_KEY = "dsh-web-ui-telemetry-opt-out";
/** Whether the user switched the family-wide opt-out on (reads storage only). */
export declare function isTelemetryOptedOut(): boolean;
/** Turn the family-wide opt-out on or off (writing '1' / removing the key); never throws. */
export declare function setTelemetryOptedOut(optedOut: boolean): void;
/** Whether a heartbeat must be suppressed right now: opt-out stored, or the browser asks not to be tracked. */
export declare function isTelemetrySuppressed(): boolean;
/**
 * Fire the daily heartbeat for the given items at most once per UTC day per
 * browser. Never throws and never blocks the caller. Items without an explicit
 * version inherit the bundle's baked build version.
 */
export declare function reportDailyHeartbeat(items: readonly TelemetryItem[]): void;
//# sourceMappingURL=telemetry.d.ts.map