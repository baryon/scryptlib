import { expect } from 'chai'
import { num2bin, bin2num, bsv } from '../src/utils'
import { serializeState } from '../src/serializer'

const BN = bsv.crypto.BN
const Script = bsv.Script

describe('serializer', () => {
  describe('BSV Script()', () => {
    it('zero', () => {
      const script = Script.fromASM('0')
      const hex = script.toHex()
      expect(hex).to.equal('00')
    })

    it('double zero', () => {
      const script = Script.fromASM('00')
      const hex = script.toHex()
      expect(hex).to.equal('0100')
    })

    it('-1', () => {
      const script = Script.fromASM('-1')
      const hex = script.toHex()
      expect(hex).to.equal('4f')
    })
  })

  describe('serializeState()', () => {
    it('object type', () => {
      const state = { counter: 11, bytes: '1234', flag: true }
      const serial = serializeState(state)
      const script = Script.fromASM(serial)
      const hex = script.toHex()

      expect(serial).to.equal('0b 1234 01 07000000')
      expect(hex).to.equal('010b02123401010407000000')
    })

    it('array type', () => {
      const state = [11, '1234', true]
      const serial = serializeState(state)
      const script = Script.fromASM(serial)
      const hex = script.toHex()

      expect(serial).to.equal('0b 1234 01 07000000')
      expect(hex).to.equal('010b02123401010407000000')
    })

    it('special number', () => {
      const state = [0, -1, 1, 11, '1234', true]
      const serial = serializeState(state)
      const script = Script.fromASM(serial)
      const hex = script.toHex()

      expect(serial).to.equal('00 81 01 0b 1234 01 0d000000')
      expect(hex).to.equal('010001810101010b0212340101040d000000')
    })

    it('special string', () => {
      const state = ['0', '-1', '1', '11', '1234', true]
      const serial = serializeState(state)
      const script = Script.fromASM(serial)
      const hex = script.toHex()

      expect(serial).to.equal('0 -1 11 1234 01 0a000000')
      expect(hex).to.equal('004f01110212340101040a000000')
    })

    it('negative number', () => {
      const state = [-100]
      const serial = serializeState(state)
      const script = Script.fromASM(serial)
      const hex = script.toHex()

      expect(serial).to.equal('e4 02000000')
      expect(hex).to.equal('01e40402000000')
    })

    it('bool', () => {
      const state = [true, false]
      const serial = serializeState(state)
      const script = Script.fromASM(serial)
      const hex = script.toHex()

      expect(serial).to.equal('01 00 04000000')
      expect(hex).to.equal('010101000404000000')
    })

    it('bigint', () => {
      const state = [0n, 0x0an, 0x123n, 0x123456789abcden, -1000n]
      const serial = serializeState(state)
      const script = Script.fromASM(serial)
      const hex = script.toHex()

      expect(serial).to.equal('0a 2301 debc9a78563412 e883 11000000')
      expect(hex).to.equal('010a02230107debc9a7856341202e8830411000000')
    })

    it('max-len bytes', () => {
      const state = ['FF'.repeat(75)]
      const serial = serializeState(state)
      const script = Script.fromASM(serial)
      const hex = script.toHex()

      expect(serial).to.equal('ff'.repeat(75) + ' 4c000000')
      expect(hex).to.equal('4b' + 'ff'.repeat(75) + '044c000000')
    })

    it('pushdata 1', () => {
      const state = ['FF'.repeat(76)]
      const serial = serializeState(state)
      const script = Script.fromASM(serial)
      const hex = script.toHex()

      expect(serial).to.equal('ff'.repeat(76) + ' 4e000000')
      expect(hex).to.equal('4c4c' + 'ff'.repeat(76) + '044e000000')
    })

    it('pushdata 2', () => {
      const state = ['FF'.repeat(2 ** 8)]
      const serialize = serializeState(state)
      const script = Script.fromASM(serialize)
      const hex = script.toHex()

      expect(serialize).to.equal('ff'.repeat(2 ** 8) + ' 03010000')
      expect(hex).to.equal('4d0001' + 'ff'.repeat(2 ** 8) + '0403010000')
    })

    it('pushdata 4', () => {
      const state = ['FF'.repeat(2 ** 16)]
      const serial = serializeState(state)
      const script = Script.fromASM(serial)
      const hex = script.toHex()

      expect(serial).to.equal('ff'.repeat(2 ** 16) + ' 05000100')
      expect(hex).to.equal('4e00000100' + 'ff'.repeat(2 ** 16) + '0405000100')
    })
  })
})
