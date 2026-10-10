// Receptores GNSS externos: por Bluetooth (lo que era window.MaspaGNSS) y por cable USB (window.MaspaGNSSUSB), con
// la misma forma que antes: supported() y connect({ device?, onFix, onStatus }) → { name, profile, rate(), disconnect() }.
export * as MaspaGNSS from "./ble";
export * as MaspaGNSSUSB from "./usb";
export type { BleConnectOptions, BleProfile, Schedule } from "./ble";
export type { UsbConnectOptions, UsbLayout } from "./usb";
export type { GnssHandle, GnssProfile, GnssState, GnssStatus } from "./receiver";
