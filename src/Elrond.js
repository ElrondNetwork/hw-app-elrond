//@flow

import type Transport from "@ledgerhq/hw-transport";
import BIPPath from "bip32-path";

export default class Elrond {
  transport: Transport<*>;

  constructor(transport: Transport<*>, scrambleKey: string = "Elrond") {
    this.transport = transport;
    transport.decorateAppAPIMethods(
      this,
      ["getAddress", "signTransaction", "getAppConfiguration"],
      scrambleKey
    );
  }

  async getAddress(
    path: string,
    display?: boolean,
    chainCode?: boolean,
    ed25519?: boolean
  ): Promise<{
    publicKey: string,
    address: string,
    chainCode?: string,
  }> {
    const bipPath = BIPPath.fromString(path).toPathArray();
    const curveMask = ed25519 ? 0x80 : 0x40;

    const cla = 0xe0;
    const ins = 0x02;
    const p1 = display ? 0x01 : 0x00;
    const p2 = curveMask | (chainCode ? 0x01 : 0x00);
    const data = Buffer.alloc(1 + bipPath.length * 4);

    data.writeInt8(bipPath.length, 0);
    bipPath.forEach((segment, index) => {
      data.writeUInt32BE(segment, 1 + index * 4);
    });

    const response = await this.transport.send(cla, ins, p1, p2, data);

    const result = {};
    const publicKeyLength = response[0];
    const addressLength = response[1 + publicKeyLength];

    result.publicKey = response.slice(1, 1 + publicKeyLength).toString("hex");

    result.address = response
      .slice(1 + publicKeyLength + 1, 1 + publicKeyLength + 1 + addressLength)
      .toString("ascii");

    if (chainCode) {
      result.chainCode = response
        .slice(
          1 + publicKeyLength + 1 + addressLength,
          1 + publicKeyLength + 1 + addressLength + 32
        )
        .toString("hex");
    }

    return result;
  }

  async signTransaction(
    path: string,
    rawTxHex: string,
    ed25519?: boolean
  ): Promise<string> {
    const bipPath = BIPPath.fromString(path).toPathArray();
    const rawTx = Buffer.from(rawTxHex, "hex");
    const curveMask = ed25519 ? 0x80 : 0x40;

    const apdus = [];
    let offset = 0;

    while (offset !== rawTx.length) {
      const isFirst = offset === 0;
      const maxChunkSize = isFirst ? 150 - 1 - bipPath.length * 4 : 150;

      const hasMore = offset + maxChunkSize < rawTx.length;
      const chunkSize = hasMore ? maxChunkSize : rawTx.length - offset;

      const apdu = {
        cla: 0xe0,
        ins: 0x04,
        p1: (isFirst ? 0x00 : 0x01) | (hasMore ? 0x80 : 0x00),
        p2: curveMask,
        data: isFirst
          ? Buffer.alloc(1 + bipPath.length * 4 + chunkSize)
          : Buffer.alloc(chunkSize),
      };

      if (isFirst) {
        apdu.data.writeInt8(bipPath.length, 0);
        bipPath.forEach((segment, index) => {
          apdu.data.writeUInt32BE(segment, 1 + index * 4);
        });
        rawTx.copy(
          apdu.data,
          1 + bipPath.length * 4,
          offset,
          offset + chunkSize
        );
      } else {
        rawTx.copy(apdu.data, 0, offset, offset + chunkSize);
      }

      apdus.push(apdu);
      offset += chunkSize;
    }

    let response = Buffer.alloc(0);
    for (let apdu of apdus) {
      response = await this.transport.send(
        apdu.cla,
        apdu.ins,
        apdu.p1,
        apdu.p2,
        apdu.data
      );
    }

    return response.slice(0, response.length - 2).toString("hex");
  }

  async getAppConfiguration(): Promise<{
    version: string,
  }> {
    const response = await this.transport.send(0xe0, 0x06, 0x00, 0x00);
    const result = {};
    result.version = "" + response[1] + "." + response[2] + "." + response[3];
    return result;
  }
}