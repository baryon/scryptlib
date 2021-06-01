import { assert, expect } from 'chai';
import { getContractFilePath, newTx, loadDescription } from './helper';
import { ABICoder, FunctionCall } from '../src/abi';
import {
  buildContractClass,
  buildTypeClasses,
  VerifyResult,
} from '../src/contract';
import { bsv, toHex, signTx, compileContract, num2bin } from '../src/utils';
import {
  Bytes,
  PubKey,
  Sig,
  Ripemd160,
  Bool,
  Struct,
  Sha256,
} from '../src/scryptTypes';

const privateKey = bsv.PrivateKey.fromRandom('testnet');
const publicKey = privateKey.publicKey;
const pubKeyHash = bsv.crypto.Hash.sha256ripemd160(publicKey.toBuffer());
const inputSatoshis = 100000;
const tx = newTx(inputSatoshis);

const jsonDescr = loadDescription('p2pkh_desc.json');
const DemoP2PKH = buildContractClass(jsonDescr);
const p2pkh = new DemoP2PKH(new Ripemd160(toHex(pubKeyHash)));

const personDescr = loadDescription('person_desc.json');
const PersonContract = buildContractClass(personDescr);

const { Person, Block } = buildTypeClasses(personDescr);

let man = new Person({
  isMale: false,
  age: 33,
  addr: new Bytes('68656c6c6f20776f726c6421'),
});

let block = new Block({
  time: 33,
  header: new Bytes('68656c6c6f20776f726c6421'),
  hash: new Bytes('68656c6c6f20776f726c6421'),
});

const person = new PersonContract(man, 18);

describe('FunctionCall', () => {
  let target: FunctionCall;
  let result: VerifyResult;

  describe('when it is the contract constructor', () => {
    before(() => {
      target = new FunctionCall(
        'constructor',
        [new Ripemd160(toHex(pubKeyHash))],
        { contract: p2pkh, lockingScriptASM: p2pkh.lockingScript.toASM() }
      );
    });

    describe('toHex() / toString()', () => {
      it('should return the locking script in hex', () => {
        assert.equal(target.toHex(), p2pkh.lockingScript.toHex());
      });
    });

    describe('toASM()', () => {
      it('should return the locking script in ASM', () => {
        assert.equal(target.toASM(), p2pkh.lockingScript.toASM());
      });
    });

    describe('verify()', () => {
      it('should fail', () => {
        result = target.verify({ inputSatoshis, tx });
        assert.isFalse(result.success);
        assert.equal(
          result.error,
          'verification failed, missing unlockingScript'
        );
      });
    });
  });

  describe('when it is a contract public function', () => {
    let sig: Sig;
    let pubkey: PubKey;

    before(() => {
      sig = new Sig(
        toHex(
          signTx(tx, privateKey, p2pkh.lockingScript.toASM(), inputSatoshis)
        )
      );
      pubkey = new PubKey(toHex(publicKey));
      target = new FunctionCall('unlock', [sig, pubkey], {
        contract: p2pkh,
        unlockingScriptASM: [sig.toASM(), pubkey.toASM()].join(' '),
      });
    });

    describe('toHex() / toString()', () => {
      it('should return the unlocking script in hex', () => {
        assert.equal(
          target.toHex(),
          bsv.Script.fromASM(target.toASM()).toHex()
        );
      });
    });

    describe('check abiParams', () => {
      it('abiParams should be correct', () => {
        expect(target.args).to.deep.include.members([
          {
            name: 'sig',
            type: 'Sig',
            value: sig,
          },
          {
            name: 'pubKey',
            type: 'PubKey',
            value: pubkey,
          },
        ]);
      });
    });

    describe('toASM()', () => {
      it('should return the unlocking script in ASM', () => {
        assert.equal(target.toASM(), [sig.toASM(), pubkey.toASM()].join(' '));
      });
    });

    describe('verify()', () => {
      it('should return true if params are appropriate', () => {
        // has no txContext in binding contract
        result = target.verify({ inputSatoshis, tx });
        assert.isTrue(result.success, result.error);

        // has txContext in binding contract
        p2pkh.txContext = { inputSatoshis, tx };
        result = target.verify();
        assert.isTrue(result.success, result.error);
        p2pkh.txContext = undefined;
      });

      it('should fail if param `inputSatoshis` is incorrect', () => {
        result = target.verify({ inputSatoshis: inputSatoshis + 1, tx });
        assert.isFalse(result.success, result.error);
        result = target.verify({ inputSatoshis: inputSatoshis - 1, tx });
        assert.isFalse(result.success, result.error);
      });

      it('should fail if param `txContext` is incorrect', () => {
        // missing txContext
        result = target.verify({ inputSatoshis });
        assert.isFalse(result.success, result.error);
        assert.equal(result.error, 'should provide txContext.tx when verify');

        // incorrect txContext.tx
        tx.nLockTime = tx.nLockTime + 1;
        result = target.verify({ inputSatoshis, tx });
        assert.isFalse(result.success, result.error);
        tx.nLockTime = tx.nLockTime - 1; //reset
      });
    });
  });

  describe('when constructor with struct', () => {
    before(() => {
      target = new FunctionCall(
        'constructor',
        [
          new Person({
            isMale: false,
            age: 33,
            addr: new Bytes('68656c6c6f20776f726c6421'),
          }),
        ],
        { contract: person, lockingScriptASM: person.lockingScript.toASM() }
      );
    });

    describe('toHex() / toString()', () => {
      it('should return the locking script in hex', () => {
        assert.equal(target.toHex(), person.lockingScript.toHex());
      });
    });

    describe('toASM()', () => {
      it('should return the locking script in ASM', () => {
        assert.equal(target.toASM(), person.lockingScript.toASM());
      });
    });
  });

  describe('when it is a contract public function with struct', () => {
    it('should return true when age 10', () => {
      let result = person.main(man, 10, false).verify();

      assert.isTrue(result.success, result.error);
    });

    it('should return false when age 36', () => {
      let result = person.main(man, 36, false).verify();

      assert.isFalse(result.success, result.error);
    });

    it('should return false when isMale true', () => {
      let result = person.main(man, 18, true).verify();

      assert.isFalse(result.success, result.error);
    });
  });

  describe('struct member check', () => {
    it('should throw with wrong members 1', () => {
      expect(() => {
        person.main(
          new Person({
            age: 14,
            addr: new Bytes('68656c6c6f20776f726c6421'),
          }),
          18,
          true
        );
      }).to.throw('argument of type struct Person missing member isMale');
    });

    it('should throw with wrong members 2', () => {
      expect(() => {
        person.main(
          new Person({
            isMale: false,
            age: 13,
          }),
          18,
          true
        );
      }).to.throw('argument of type struct Person missing member addr');
    });

    it('should throw with wrong members 3', () => {
      expect(() => {
        person.main(
          new Person({
            weight: 100,
            isMale: false,
            age: 13,
            addr: new Bytes('68656c6c6f20776f726c6421'),
          }),
          18,
          true
        );
      }).to.throw('weight is not a member of struct Person');
    });

    it('should throw with wrong members type', () => {
      expect(() => {
        person.main(
          new Person({
            isMale: 11,
            age: 14,
            addr: new Bytes('68656c6c6f20776f726c6421'),
          }),
          18,
          true
        );
      }).to.throw('wrong argument type, expected bool but got int');
    });
  });

  describe('struct type check', () => {
    it('should throw with wrong struct type 1', () => {
      expect(() => {
        person.main(block, 18, true);
      }).to.throw('expect struct Person but got struct Block');
    });

    it('should throw with wrong struct type 2', () => {
      expect(() => {
        new PersonContract(block, 18);
      }).to.throw('expect struct Person but got struct Block');
    });
  });
});

describe('ABICoder', () => {
  describe('encodeConstructorCall()', () => {
    describe('when contract has explict constructor', () => {
      it('encodeConstructorCall RegExp replace error fix issue #86 1', () => {
        const DemoCoinToss = buildContractClass(
          loadDescription('cointoss_desc.json')
        );
        let demoCoinToss = new DemoCoinToss(
          new PubKey(
            '034e1f55a9eeec718a19741a04005a87c90de32be5356eb3711905aaf2c9cee281'
          ),
          new PubKey(
            '039671758bb8190eaf4c5b03a424c27012aaee0bc9ee1ce19d711b201159cf9fc2'
          ),
          new Sha256(
            'bfdd565761a74bd95110da480a45e3b408a43aff335473134ef3074637ecbae1'
          ),
          new Sha256(
            'd806b80dd9e76ef5d6be50b6e5c8a54a79fa05d3055f452e5d91e4792f790e0b'
          ),
          555
        );

        expect(demoCoinToss.lockingScript.toASM()).to.be.contain(
          '034e1f55a9eeec718a19741a04005a87c90de32be5356eb3711905aaf2c9cee281 039671758bb8190eaf4c5b03a424c27012aaee0bc9ee1ce19d711b201159cf9fc2 bfdd565761a74bd95110da480a45e3b408a43aff335473134ef3074637ecbae1 d806b80dd9e76ef5d6be50b6e5c8a54a79fa05d3055f452e5d91e4792f790e0b 2b02'
        );
      });

      it('encodeConstructorCall RegExp replace error fix issue #86 2', () => {
        const MultiSig = buildContractClass(
          loadDescription('multiSig_desc.json')
        );
        let multiSig = new MultiSig([
          new Ripemd160('2f87fe26049415441f024eb134ce54bbafd78e96'),
          new Ripemd160('9e0ad5f79a7a91cce4f36ebeb6c0d392001683e9'),
          new Ripemd160('58ddca9a92ebf90edf505a172fcef1197b376f5d'),
        ]);

        expect(multiSig.lockingScript.toASM()).to.be.contain(
          '2f87fe26049415441f024eb134ce54bbafd78e96 9e0ad5f79a7a91cce4f36ebeb6c0d392001683e9 58ddca9a92ebf90edf505a172fcef1197b376f5d'
        );
      });
    });

    describe('when contract has no explict constructor', () => {
      it('should return FunctionCall object for contract constructor');
    });
  });

  describe('encodePubFunctionCall()', () => {
    it('should return FunctionCall object for contract public method');
  });
});
