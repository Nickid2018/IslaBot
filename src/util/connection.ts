import { Readable, Writable } from 'node:stream';
import * as net from 'node:net';

type WMethodKeys<T, A extends bigint | number> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any
    ? Parameters<T[K]>[0] extends A
      ? Parameters<T[K]>[1] extends number | undefined
        ? Parameters<T[K]>[1] extends number
          ? never
          : K
        : never
      : never
    : never;
}[keyof T];

type RMethodKeys<T, A extends bigint | number> = {
  [K in keyof T]: T[K] extends (...args: any[]) => A
    ? K extends `read${string}`
      ? Parameters<T[K]>[0] extends number | undefined
        ? Parameters<T[K]>[0] extends number
          ? never
          : K
        : never
      : never
    : never;
}[keyof T];

export function writeVarInt(buffer: number[], val: number, offset?: number) {
  const writeBuffer = [];
  while (true) {
    if ((val & 0xffffff80) == 0) {
      writeBuffer.push(val);
      break;
    }
    writeBuffer.push((val & 0x7f) | 0x80);
    val >>>= 7;
  }
  if (offset !== undefined) buffer.splice(offset, 0, ...writeBuffer);
  else buffer.push(...writeBuffer);
}

export function readVarInt(conn: Readable) {
  let i = 0;
  let j = 0;
  while (true) {
    const k = conn.read(1);
    i |= (k & 0x7f) << (j++ * 7);
    if (j > 5) return null;
    if ((k & 0x80) != 128) break;
  }
  return i;
}

export async function createSocket(
  options: net.NetConnectOpts,
): Promise<Connection & { end: () => void }> {
  const socket = await new Promise<net.Socket>((resolve, reject) => {
    try {
      const socket = net.createConnection(options, () => resolve(socket));
      socket.on('error', (err) => reject(err));
    } catch (e) {
      reject(e);
    }
  });
  return Object.assign(new Connection(socket, socket), {
    end: () => socket.end(),
  });
}

export class Connection {
  private readBuffer: Buffer = Buffer.from([]);
  private nextResolve: () => void = () => {};
  private nextReject: (e: any) => void = () => {};
  private nextPromise: Promise<void> = Promise.resolve();

  constructor(
    private readonly readable: Readable,
    private readonly writable: Writable,
  ) {
    this.nextPromise = new Promise((r, j) => {
      this.nextResolve = r;
      this.nextReject = j;
    });
    readable.on('data', (chunk) => {
      this.readBuffer = Buffer.concat([this.readBuffer, Buffer.from(chunk)]);
      const resolve = this.nextResolve;
      this.nextPromise = new Promise((r, j) => {
        this.nextResolve = r;
        this.nextReject = j;
      });
      resolve();
    });
    readable.on('close', () => {
      this.nextPromise = Promise.resolve();
      this.nextResolve();
    });
    readable.on('end', () => {
      this.nextPromise = Promise.resolve();
      this.nextResolve();
    })
    readable.on('error', (e) => {
      const reject = this.nextReject;
      this.nextPromise = new Promise((r, j) => {
        this.nextResolve = r;
        this.nextReject = j;
      });
      reject(e);
    });
  }

  cork = () => this.writable.cork();
  uncork = () => this.writable.uncork();
  write = (chunk: Buffer) => this.writable.write(chunk);

  async read(len: number) {
    while (this.readBuffer.length < len) await this.nextPromise;
    const read = this.readBuffer.subarray(0, len);
    this.readBuffer = this.readBuffer.subarray(len);
    return read;
  }

  async writeVarInt(data: number) {
    const writeBuffer: number[] = [];
    writeVarInt(writeBuffer, data);
    this.write(Buffer.from(writeBuffer));
  }

  async readVarInt() {
    let i = 0;
    let j = 0;
    while (true) {
      const k = await this.readUInt8();
      i |= (k & 0x7f) << (j++ * 7);
      if (j > 5) return null;
      if ((k & 0x80) != 128) break;
    }
    return i;
  }

  _wrapBufferW =
    <T extends bigint | number>() =>
    <K extends WMethodKeys<Buffer, T>>(func: K, len: number) =>
    (num: T) => {
      if (this.writable.closed) throw 'connection closed';
      const buffer = Buffer.alloc(len);
      // @ts-ignore
      buffer[func](num);
      this.write(buffer);
    };

  _wrapBufferR =
    <T extends bigint | number>() =>
    <K extends RMethodKeys<Buffer, T>>(
      func: K,
      len: number,
    ): (() => Promise<T>) => {
      return async () => {
        if (this.readable.closed) throw 'connection closed';
        while (this.readBuffer.length < len) {
          await this.nextPromise;
          if (this.readable.closed) throw 'connection closed';
        }
        const data = this.readBuffer[func]();
        this.readBuffer = this.readBuffer.subarray(len);
        return data as T;
      };
    };

  writeBigInt64BE = this._wrapBufferW<bigint>()('writeBigInt64BE', 8);
  writeBigInt64LE = this._wrapBufferW<bigint>()('writeBigInt64LE', 8);
  writeBigUInt64BE = this._wrapBufferW<bigint>()('writeBigUInt64BE', 8);
  writeBigUInt64LE = this._wrapBufferW<bigint>()('writeBigUInt64LE', 8);
  writeBigUint64BE = this._wrapBufferW<bigint>()('writeBigUint64BE', 8);
  writeBigUint64LE = this._wrapBufferW<bigint>()('writeBigUint64LE', 8);
  writeUint8 = this._wrapBufferW<number>()('writeUint8', 1);
  writeUInt8 = this._wrapBufferW<number>()('writeUInt8', 1);
  writeUint16BE = this._wrapBufferW<number>()('writeUint16BE', 2);
  writeUint16LE = this._wrapBufferW<number>()('writeUint16LE', 2);
  writeUInt16BE = this._wrapBufferW<number>()('writeUInt16BE', 2);
  writeUInt16LE = this._wrapBufferW<number>()('writeUInt16LE', 2);
  writeUint32BE = this._wrapBufferW<number>()('writeUint32BE', 4);
  writeUint32LE = this._wrapBufferW<number>()('writeUint32LE', 4);
  writeUInt32BE = this._wrapBufferW<number>()('writeUInt32BE', 4);
  writeUInt32LE = this._wrapBufferW<number>()('writeUInt32LE', 4);
  writeInt8 = this._wrapBufferW<number>()('writeInt8', 1);
  writeInt16BE = this._wrapBufferW<number>()('writeInt16BE', 2);
  writeInt16LE = this._wrapBufferW<number>()('writeInt16LE', 2);
  writeInt32BE = this._wrapBufferW<number>()('writeInt32BE', 4);
  writeInt32LE = this._wrapBufferW<number>()('writeInt32LE', 4);

  readBigInt64BE = this._wrapBufferR<bigint>()('readBigInt64BE', 8);
  readBigInt64LE = this._wrapBufferR<bigint>()('readBigInt64LE', 8);
  readBigUInt64BE = this._wrapBufferR<bigint>()('readBigUInt64BE', 8);
  readBigUInt64LE = this._wrapBufferR<bigint>()('readBigUInt64LE', 8);
  readBigUint64BE = this._wrapBufferR<bigint>()('readBigUint64BE', 8);
  readBigUint64LE = this._wrapBufferR<bigint>()('readBigUint64LE', 8);
  readUint8 = this._wrapBufferR<number>()('readUint8', 1);
  readUInt8 = this._wrapBufferR<number>()('readUInt8', 1);
  readUint16BE = this._wrapBufferR<number>()('readUint16BE', 2);
  readUint16LE = this._wrapBufferR<number>()('readUint16LE', 2);
  readUInt16BE = this._wrapBufferR<number>()('readUInt16BE', 2);
  readUInt16LE = this._wrapBufferR<number>()('readUInt16LE', 2);
  readUint32BE = this._wrapBufferR<number>()('readUint32BE', 4);
  readUint32LE = this._wrapBufferR<number>()('readUint32LE', 4);
  readUInt32BE = this._wrapBufferR<number>()('readUInt32BE', 4);
  readUInt32LE = this._wrapBufferR<number>()('readUInt32LE', 4);
  readInt8 = this._wrapBufferR<number>()('readInt8', 1);
  readInt16BE = this._wrapBufferR<number>()('readInt16BE', 2);
  readInt16LE = this._wrapBufferR<number>()('readInt16LE', 2);
  readInt32BE = this._wrapBufferR<number>()('readInt32BE', 4);
  readInt32LE = this._wrapBufferR<number>()('readInt32LE', 4);
}
