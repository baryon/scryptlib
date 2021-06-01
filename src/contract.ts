import { ABICoder, Arguments, FunctionCall, Script } from './abi';
import { serializeState, State } from './serializer';
import {
  bsv,
  DEFAULT_FLAGS,
  resolveType,
  path2uri,
  isStructType,
  getStructNameByType,
  isArrayType,
  arrayTypeAndSize,
  stripAnsi,
} from './utils';
import {
  Struct,
  SupportedParamType,
  StructObject,
  ScryptType,
  VariableType,
  Int,
  Bytes,
  BasicScryptType,
  ValueType,
  TypeResolver,
  SigHashPreimage,
  SigHashType,
} from './scryptTypes';
import {
  StructEntity,
  ABIEntity,
  OpCode,
  CompileResult,
  desc2CompileResult,
  AliasEntity,
  Pos,
} from './compilerWrapper';

import * as Interpreter from './interpreter';

export interface TxContext {
  tx?: any;
  inputIndex?: number;
  inputSatoshis?: number;
  opReturn?: string;
}

export type VerifyError = string;

export interface VerifyResult {
  success: boolean;
  error?: VerifyError;
}

export interface ContractDescription {
  version: number;
  compilerVersion: string;
  contract: string;
  md5: string;
  structs: Array<StructEntity>;
  alias: Array<AliasEntity>;
  abi: Array<ABIEntity>;
  asm: string;
  file: string;
  sources: Array<string>;
  sourceMap: Array<string>;
}

export type AsmVarValues = { [key: string]: string };
export type StepIndex = number;

export class AbstractContract {
  public static contractName: string;
  public static abi: ABIEntity[];
  public static asm: string;
  public static abiCoder: ABICoder;
  public static opcodes?: OpCode[];
  public static file: string;
  public static structs: StructEntity[];

  scriptedConstructor: FunctionCall;
  calls: Map<string, FunctionCall> = new Map();
  asmArgs: AsmVarValues | null = null;

  get lockingScript(): Script {
    let lsASM = this.scriptedConstructor.toASM();
    if (typeof this._dataPart === 'string') {
      const dp = this._dataPart.trim();
      if (dp) {
        lsASM += ` OP_RETURN ${dp}`;
      } else {
        lsASM += ' OP_RETURN'; // note there is no space after op_return
      }
    }
    return bsv.Script.fromASM(lsASM.trim());
  }

  private _txContext?: TxContext;

  set txContext(txContext: TxContext) {
    this._txContext = txContext;
  }

  get txContext(): TxContext {
    return this._txContext;
  }

  // replace assembly variables with assembly values
  replaceAsmVars(asmVarValues: AsmVarValues): void {
    this.asmArgs = asmVarValues;
    this.scriptedConstructor.init(asmVarValues);
  }

  static findSrcInfo(
    interpretStates: any[],
    opcodes: OpCode[],
    stepIndex: number,
    opcodesIndex: number
  ): OpCode | undefined {
    while (--stepIndex > 0 && --opcodesIndex > 0) {
      if (
        opcodes[opcodesIndex].pos &&
        opcodes[opcodesIndex].pos.file !== 'std' &&
        opcodes[opcodesIndex].pos.line > 0 &&
        interpretStates[stepIndex].step.fExec
      ) {
        return opcodes[opcodesIndex];
      }
    }
  }

  static findLastfExec(
    interpretStates: any[],
    stepIndex: StepIndex
  ): StepIndex {
    while (--stepIndex > 0) {
      if (interpretStates[stepIndex].step.fExec) {
        return stepIndex;
      }
    }
  }

  run_verify(
    unlockingScriptASM: string,
    txContext?: TxContext,
    args?: Arguments
  ): VerifyResult {
    const txCtx: TxContext = Object.assign(
      {},
      this._txContext || {},
      txContext || {}
    );

    const us = bsv.Script.fromASM(unlockingScriptASM.trim());
    const ls = this.lockingScript;
    const tx = txCtx.tx;
    const inputIndex = txCtx.inputIndex || 0;
    const inputSatoshis = txCtx.inputSatoshis || 0;

    const bsi = new Interpreter();

    let stepCounter: StepIndex = 0;
    const interpretStates: any[] = [];
    bsi.stepListener = function (step: any, stack: any[], altstack: any[]) {
      interpretStates.push({
        mainstack: stack,
        altstack: altstack,
        step: step,
      });
      stepCounter++;
    };

    const opcodes: OpCode[] = Object.getPrototypeOf(this).constructor.opcodes;

    const result = bsi.verify(
      us,
      ls,
      tx,
      inputIndex,
      DEFAULT_FLAGS,
      new bsv.crypto.BN(inputSatoshis)
    );

    let error = result ? '' : `VerifyError: ${bsi.errstr}`;

    // some time there is no opcodes, such as when sourcemap flag is closeed.
    if (!result && opcodes) {
      const offset = unlockingScriptASM.trim().split(' ').length;
      // the complete script may have op_return and data, but compiled output does not have it. So we need to make sure the index is in boundary.

      const lastStepIndex = AbstractContract.findLastfExec(
        interpretStates,
        stepCounter
      );

      //have passed all opcodes, no last step index
      if (lastStepIndex) {
        if (typeof this._dataPart === 'string') {
          opcodes.push({ opcode: 'OP_RETURN', stack: [] });
          const dp = this._dataPart.trim();
          if (dp) {
            dp.split(' ').forEach((data) => {
              opcodes.push({ opcode: data, stack: [] });
            });
          }
        }

        let opcodeIndex = lastStepIndex - offset;
        if (stepCounter < opcodes.length + offset) {
          // not all opcodes were executed, stopped in the middle at opcode like OP_VERIFY
          opcodeIndex += 1;
        }

        if (!result && opcodes[opcodeIndex]) {
          const opcode = opcodes[opcodeIndex];

          if (!opcode.pos || opcode.pos.file === 'std') {
            const srcInfo = AbstractContract.findSrcInfo(
              interpretStates,
              opcodes,
              lastStepIndex,
              opcodeIndex
            );

            if (srcInfo) {
              opcode.pos = srcInfo.pos;
            }
          }

          // in vscode termianal need to use [:] to jump to file line, but here need to use [#] to jump to file line in output channel.
          if (opcode.pos) {
            error = `VerifyError: ${bsi.errstr} \n\t[Go to Source](${path2uri(
              opcode.pos.file
            )}#${opcode.pos.line})  fails at ${opcode.opcode}\n`;
            // if (
            //   args &&
            //   [
            //     'OP_CHECKSIG',
            //     'OP_CHECKSIGVERIFY',
            //     'OP_CHECKMULTISIG',
            //     'OP_CHECKMULTISIGVERIFY',
            //   ].includes(opcode.opcode)
            // ) {
            // }
          }
        }
      }
      if (!txCtx) {
        error = error + 'should provide txContext when verify';
      }
      if (!tx) {
        error = error + 'should provide txContext.tx when verify';
      }
    }

    return {
      success: result,
      error: error,
    };
  }

  private _dataPart: string | undefined;

  set dataPart(dataInScript: Script | undefined) {
    throw new Error(
      'Setter for dataPart is not available. Please use: setDataPart() instead'
    );
  }

  get dataPart(): Script | undefined {
    return this._dataPart !== undefined
      ? bsv.Script.fromASM(this._dataPart)
      : undefined;
  }

  setDataPart(state: State | string): void {
    if (typeof state === 'string') {
      // TODO: validate hex string
      this._dataPart = state.trim();
    } else {
      this._dataPart = serializeState(state);
    }
  }

  get codePart(): Script {
    const codeASM = this.scriptedConstructor.toASM();
    // note: do not trim the trailing space
    return bsv.Script.fromASM(codeASM + ' OP_RETURN');
  }

  static getAsmVars(contractAsm, instAsm): AsmVarValues | null {
    const regex = /(\$\S+)/g;
    const vars = contractAsm.match(regex);
    if (vars === null) {
      return null;
    }
    const asmArray = contractAsm.split(/\s/g);
    const lsASMArray = instAsm.split(/\s/g);
    const result = {};
    for (let i = 0; i < asmArray.length; i++) {
      for (let j = 0; j < vars.length; j++) {
        if (vars[j] === asmArray[i]) {
          result[vars[j].replace('$', '')] = lsASMArray[i];
        }
      }
    }
    return result;
  }

  public arguments(pubFuncName: string): Arguments {
    if (pubFuncName === 'constructor') {
      return this.scriptedConstructor.args;
    }

    if (this.calls.has(pubFuncName)) {
      return this.calls.get(pubFuncName).args;
    }

    return [];
  }
}

const invalidMethodName = [
  'arguments',
  'setDataPart',
  'run_verify',
  'replaceAsmVars',
  'asmVars',
  'asmArguments',
  'dataPart',
  'lockingScript',
  'txContext',
];

export function buildContractClass(
  desc: CompileResult | ContractDescription,
  asmContract = false
): any {
  if (!desc.contract) {
    throw new Error('missing field `contract` in description');
  }

  if (!desc.abi) {
    throw new Error('missing field `abi` in description');
  }

  if (!desc.asm) {
    throw new Error('missing field `asm` in description');
  }

  if (!desc['errors']) {
    desc = desc2CompileResult(desc as ContractDescription);
  } else {
    desc = desc as CompileResult;
  }

  const ContractClass = class Contract extends AbstractContract {
    constructor(...ctorParams: SupportedParamType[]) {
      super();
      if (!asmContract) {
        this.scriptedConstructor = Contract.abiCoder.encodeConstructorCall(
          this,
          Contract.asm,
          ...ctorParams
        );
      }
    }

    //When create a contract instance using UTXO,
    //use fromHex or fromASM because you do not know the parameters of constructor.

    /**
     * Create a contract instance using UTXO asm
     * @param hex
     */
    static fromASM(asm: string) {
      const obj = new this();
      obj.scriptedConstructor = Contract.abiCoder.encodeConstructorCallFromASM(
        obj,
        asm
      );
      return obj;
    }

    /**
     * Create a contract instance using UTXO hex
     * @param hex
     */
    static fromHex(hex: string) {
      return ContractClass.fromASM(new bsv.Script(hex).toASM());
    }

    /**
     * Get the parameter of the constructor and inline asm vars,
     * all values is hex string, need convert it to number or bytes on using
     */
    get asmVars(): AsmVarValues | null {
      return AbstractContract.getAsmVars(
        Contract.asm,
        this.scriptedConstructor.toASM()
      );
    }

    get asmArguments(): AsmVarValues | null {
      //TODO: @deprecate AbstractContract.getAsmVars , using asmArguments

      return null;
    }
  };

  ContractClass.contractName = desc.contract;
  ContractClass.abi = desc.abi;
  ContractClass.asm = desc.asm.map((item) => item['opcode'].trim()).join(' ');
  ContractClass.abiCoder = new ABICoder(desc.abi, desc.alias || []);
  ContractClass.opcodes = desc.asm;
  ContractClass.file = desc.file;
  ContractClass.structs = desc.structs;

  ContractClass.abi.forEach((entity) => {
    if (invalidMethodName.indexOf(entity.name) > -1) {
      throw new Error(
        `Method name [${entity.name}] is used by scryptlib now, Pelease change you contract method name!`
      );
    }
    ContractClass.prototype[entity.name] = function (
      ...args: SupportedParamType[]
    ): FunctionCall {
      const call = ContractClass.abiCoder.encodePubFunctionCall(
        this,
        entity.name,
        args
      );
      this.calls.set(entity.name, call);
      return call;
    };
  });

  return ContractClass;
}

/**
 * @deprecated use buildTypeClasses
 * @param desc CompileResult or ContractDescription
 */
export function buildStructsClass(
  desc: CompileResult | ContractDescription
): Record<string, typeof Struct> {
  const structTypes: Record<string, typeof Struct> = {};

  const structs: StructEntity[] = desc.structs || [];
  const alias: AliasEntity[] = desc.alias || [];
  const finalTypeResolver = buildTypeResolver(alias);
  structs.forEach((element) => {
    const name = element.name;

    Object.assign(structTypes, {
      [name]: class extends Struct {
        constructor(o: StructObject) {
          super(o);
          this._typeResolver = finalTypeResolver; //we should assign this before bind
          this.bind();
        }
      },
    });

    structTypes[name].structAst = element;
  });

  return structTypes;
}

export function buildTypeClasses(
  desc: CompileResult | ContractDescription
): Record<string, typeof ScryptType> {
  const structClasses = buildStructsClass(desc);
  const aliasTypes: Record<string, typeof ScryptType> = {};
  const alias: AliasEntity[] = desc.alias || [];
  const finalTypeResolver = buildTypeResolver(alias);
  alias.forEach((element) => {
    const finalType = finalTypeResolver(element.name);
    if (isStructType(finalType)) {
      const type = getStructNameByType(finalType);
      Object.assign(aliasTypes, {
        [element.name]: class extends structClasses[type] {
          constructor(o: StructObject) {
            super(o);
            this._type = element.name;
            this._typeResolver = finalTypeResolver;
          }
        },
      });
    } else if (isArrayType(finalType)) {
      //TODO: just return some class, but they are useless
      const [elemTypeName, _] = arrayTypeAndSize(finalType);

      const C = BasicScryptType[elemTypeName];
      if (C) {
        Object.assign(aliasTypes, {
          [element.name]: class extends Array<typeof C> {},
        });
      } else if (isStructType(elemTypeName)) {
        const type = getStructNameByType(elemTypeName);
        const C = structClasses[type];
        Object.assign(aliasTypes, {
          [element.name]: class extends Array<typeof C> {},
        });
      }
    } else {
      const C = BasicScryptType[finalType];
      if (C) {
        const Class = C as typeof ScryptType;
        const aliasClass = class extends Class {
          constructor(o: ValueType) {
            super(o);
            this._type = element.name;
            this._typeResolver = finalTypeResolver;
          }
        };

        Object.assign(aliasTypes, {
          [element.name]: aliasClass,
        });
      } else {
        throw new Error(
          `can not resolve type alias ${element.name} ${element.type}`
        );
      }
    }
  });

  Object.assign(aliasTypes, structClasses);

  return aliasTypes;
}

export function buildTypeResolver(alias: AliasEntity[]): TypeResolver {
  const resolvedTypes: Record<string, string> = {};
  alias.forEach((element) => {
    const finalType = resolveType(alias, element.name);
    resolvedTypes[element.name] = finalType;
  });
  return (alias: string) => {
    if (isStructType(alias)) {
      alias = getStructNameByType(alias);
    }

    let arrayType = '';
    if (isArrayType(alias)) {
      const [elemTypeName, sizes] = arrayTypeAndSize(alias);

      if (isStructType(elemTypeName)) {
        alias = getStructNameByType(elemTypeName);
      } else {
        alias = elemTypeName;
      }

      arrayType = sizes.map((size) => `[${size}]`).join('');
    }

    if (BasicScryptType[alias]) {
      return `${alias}${arrayType}`;
    }

    if (resolvedTypes[alias]) {
      return `${resolvedTypes[alias]}${arrayType}`;
    }

    return `struct ${alias} {}${arrayType}`;
  };
}
