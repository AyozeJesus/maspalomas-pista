// Lo poco de Web Bluetooth y WebUSB que usan los receptores externos. TypeScript no los trae (solo los tiene Chrome) y
// no se añade ningún paquete: los nombres son los de las normas, con solo los miembros que se usan. Lo que puede faltar
// en un navegador (o en un aparato) va como opcional, porque el código lo comprueba antes de usarlo.

// ---------- Web Bluetooth ----------

export interface BluetoothLEScanFilter {
  name?: string;
  namePrefix?: string;
  services?: string[];
}

export interface RequestDeviceOptions {
  filters: BluetoothLEScanFilter[];
  optionalServices?: string[];
}

export interface Bluetooth {
  requestDevice?(options: RequestDeviceOptions): Promise<BluetoothDevice>;
}

export interface BluetoothDevice {
  readonly name?: string;
  readonly gatt: BluetoothRemoteGATTServer;
  addEventListener(type: "gattserverdisconnected", listener: () => void): void;
  removeEventListener(type: "gattserverdisconnected", listener: () => void): void;
}

export interface BluetoothRemoteGATTServer {
  readonly connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: string): Promise<BluetoothRemoteGATTService>;
}

export interface BluetoothRemoteGATTService {
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGATTCharacteristic>;
}

// «characteristicvaluechanged»: su target es la característica, con el valor que acaba de llegar.
export interface CharacteristicValueChangedEvent {
  readonly target: { readonly value: DataView };
}

export type CharacteristicValueListener = (ev: CharacteristicValueChangedEvent) => void;

export interface BluetoothRemoteGATTCharacteristic {
  startNotifications(): Promise<unknown>;
  writeValueWithResponse?(value: BufferSource): Promise<void>;
  writeValue(value: BufferSource): Promise<void>;
  addEventListener(type: "characteristicvaluechanged", listener: CharacteristicValueListener): void;
  removeEventListener(
    type: "characteristicvaluechanged",
    listener: CharacteristicValueListener,
  ): void;
}

// ---------- WebUSB ----------

export type USBDirection = "in" | "out";

export interface USBEndpoint {
  readonly endpointNumber: number;
  readonly direction: USBDirection;
  readonly type: "bulk" | "interrupt" | "isochronous";
}

export interface USBAlternateInterface {
  readonly interfaceClass: number;
  readonly endpoints: readonly USBEndpoint[];
}

export interface USBInterface {
  readonly interfaceNumber: number;
  readonly alternate?: USBAlternateInterface | null;
  readonly alternates?: readonly USBAlternateInterface[];
}

export interface USBConfiguration {
  readonly interfaces: readonly USBInterface[];
}

export interface USBControlTransferParameters {
  requestType: "standard" | "class" | "vendor";
  recipient: "device" | "interface" | "endpoint" | "other";
  request: number;
  value: number;
  index: number;
}

export interface USBInTransferResult {
  readonly data?: DataView | null;
  readonly status: "ok" | "stall" | "babble";
}

export interface USBOutTransferResult {
  readonly bytesWritten: number;
  readonly status: "ok" | "stall";
}

export interface USBDevice {
  readonly vendorId: number;
  readonly productName?: string;
  readonly configuration?: USBConfiguration | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  controlTransferOut(
    setup: USBControlTransferParameters,
    data?: BufferSource,
  ): Promise<USBOutTransferResult>;
  transferIn(endpointNumber: number, length: number): Promise<USBInTransferResult>;
  clearHalt(direction: USBDirection, endpointNumber: number): Promise<void>;
}

export interface USBDeviceFilter {
  vendorId?: number;
  productId?: number;
  classCode?: number;
  subclassCode?: number;
  protocolCode?: number;
  serialNumber?: string;
}

export interface USBDeviceRequestOptions {
  filters: readonly USBDeviceFilter[];
}

// «connect» y «disconnect» de navigator.usb: el aparato enchufado o desenchufado.
export interface USBConnectionEvent {
  readonly device: USBDevice;
}

export type USBConnectionListener = (ev: USBConnectionEvent) => void;

export interface USB {
  requestDevice?(options: USBDeviceRequestOptions): Promise<USBDevice>;
  getDevices?(): Promise<USBDevice[]>;
  addEventListener(type: "connect" | "disconnect", listener: USBConnectionListener): void;
  removeEventListener(type: "connect" | "disconnect", listener: USBConnectionListener): void;
}

// navigator con lo que solo tiene Chrome, si lo tiene.
export type SerialNavigator = Navigator & {
  readonly bluetooth?: Bluetooth;
  readonly usb?: USB;
};
