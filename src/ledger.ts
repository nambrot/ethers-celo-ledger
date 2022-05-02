import { Signer } from "@ethersproject/abstract-signer";
import { Bytes } from "@ethersproject/bytes";
import { Deferrable } from "@ethersproject/properties";
import Ledger from '@ledgerhq/hw-app-eth'
import { CeloProvider, CeloTransactionRequest, parseCeloTransaction, serializeCeloTransaction } from '@celo-tools/celo-ethers-wrapper'
import { BigNumber, utils } from "ethers";
import { ensureLeading0x, trimLeading0x } from "./utils";

const forwardErrors = [
  utils.Logger.errors.INSUFFICIENT_FUNDS,
  utils.Logger.errors.NONCE_EXPIRED,
  utils.Logger.errors.REPLACEMENT_UNDERPRICED,
];

export class LedgerSigner extends Signer {
  private readonly ledger: Ledger

  constructor(public readonly provider: CeloProvider, public readonly chainId: number, public readonly derivationPath: string, ledgerTransport: any) {
    super()
    this.ledger = new Ledger(ledgerTransport)
    Object.defineProperty(this, "_isSigner", { enumerable: true, value: true, writable: false })
  }
  connect(): Signer {
    throw new Error('Connect method unimplemented on LedgerSigner')
  }

  async getAddress() {
    const data = await this.ledger.getAddress(this.derivationPath)
    return data.address
  }

  signMessage(message: string | Bytes): Promise<string> {
    throw new Error("Method not implemented.");
  }

  async populateTransaction(transaction: utils.Deferrable<CeloTransactionRequest>): Promise<any> {
    const tx: any = await utils.resolveProperties(transaction)
    if (!tx.to) {
      throw new Error('Tx is missing mandatory fields')
    }

    if (tx.gasPrice == null) {
      tx.gasPrice = this.getGasPrice();
    }
  
    if (tx.nonce == null) {
      const nonce = await this.getTransactionCount('pending')
      tx.nonce = BigNumber.from(nonce).toNumber()
    }

    if (tx.gasLimit == null) {
      tx.gasLimit = this.estimateGas(tx).catch((error) => {
        if (forwardErrors.indexOf(error.code) >= 0) {
          throw error;
        }

        throw Error(
          "cannot estimate gas; transaction may fail or may require manual gas limit"
        );
      });
    }

    if (tx.chainId == null) {
      tx.chainId = this.chainId
    } else if (tx.chainId !== this.chainId) {
      throw new Error('Chain Id mismatch')
    }

    return tx
  }

  async signTransaction(transaction: Deferrable<CeloTransactionRequest>): Promise<string> {
    const address = await this.getAddress()
    const tx = await this.populateTransaction(transaction)

    if (tx.from != null) {
      if (utils.getAddress(tx.from) !== address) {
        throw new Error('Transaction from address mismatch')
      }
      delete tx.from
    }

    // Ledger expects hex without leading 0x
    const unsignedTx = trimLeading0x(serializeCeloTransaction(tx))
    const sig = await this.ledger.signTransaction(this.derivationPath, unsignedTx)

    const sigV = parseInt(sig.v, 16)
    let eip155V = this.chainId * 2 + 35
    if (sigV !== eip155V && (sigV & eip155V) !== sigV) {
      eip155V += 1 // add signature v bit.
    }
    const serializedTx = serializeCeloTransaction(tx, {
      v: BigNumber.from(ensureLeading0x(eip155V.toString(16))).toNumber(),
      r: ensureLeading0x(sig.r),
      s: ensureLeading0x(sig.s),
    })

    const parsedTx = parseCeloTransaction(serializedTx)
    return serializeCeloTransaction(tx, {
      v: BigNumber.from(ensureLeading0x(eip155V.toString(16))).toNumber(),
      r: ensureLeading0x(sig.r),
      s: ensureLeading0x(sig.s),
    })
  }

  async estimateGas(
    transaction: utils.Deferrable<CeloTransactionRequest>
  ): Promise<BigNumber> {
    this._checkProvider("estimateGas");
    const tx = await utils.resolveProperties(transaction);
    return await this.provider.estimateGas(tx);
  }

  /**
   * Override to support alternative gas currencies
   * https://github.com/celo-tools/ethers.js/blob/master/packages/abstract-signer/src.ts/index.ts
   */
  async getGasPrice(feeCurrencyAddress?: string): Promise<BigNumber> {
    this._checkProvider("getGasPrice");
    // @ts-ignore
    return await this.provider.getGasPrice(feeCurrencyAddress);
  }
}