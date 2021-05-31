import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { bsv } from '../src/utils';
import { ContractDescription } from '../src/contract';
export function loadDescription(fileName: string): ContractDescription {
  return JSON.parse(
    readFileSync(join(__dirname, '../out/', fileName)).toString()
  );
}

export function loadASM(fileName: string): string {
  return readFileSync(
    join(__dirname, 'fixture', fileName.replace('.scrypt', '_asm.json'))
  ).toString();
}

export function getContractFilePath(fileName: string): string {
  return join(__dirname, 'fixture', fileName);
}

export function getInvalidContractFilePath(fileName: string): string {
  return join(__dirname, 'fixture', 'invalid', fileName);
}

export function newTx(inputSatoshis: number) {
  const utxo = {
    txId: 'a477af6b2667c29670467e4e0728b685ee07b240235771862318e29ddbe58458',
    outputIndex: 0,
    script: '', // placeholder
    satoshis: inputSatoshis,
  };
  return new bsv.Transaction().from(utxo);
}

export function deleteSource(o: any) {
  Object.keys(o).forEach((key) => {
    if (key === 'source') {
      delete o['source'];
    }

    if (typeof o[key] === 'object' && o[key] !== null) {
      deleteSource(o[key]);
    }
  });
}
