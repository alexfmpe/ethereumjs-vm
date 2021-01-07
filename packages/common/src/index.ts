import { buf as crc32Buffer } from 'crc-32'
import { _getInitializedChains } from './chains'
import { hardforks as HARDFORK_CHANGES } from './hardforks'
import { EIPs } from './eips'
import { BootstrapNode, Chain, GenesisBlock, Hardfork } from './types'

/**
 * Options for instantiating a [[Common]] instance.
 */
export interface CommonOpts {
  /**
   * String ('mainnet') or Number (1) chain
   */
  chain: string | number | object
  /**
   * String identifier ('byzantium') for hardfork
   *
   * Default: `istanbul`
   */
  hardfork?: string
  /**
   * Limit parameter returns to the given hardforks
   */
  supportedHardforks?: Array<string>
  /**
   * Selected EIPs which can be activated, please use an array for instantiation
   * (e.g. `eips: [ 2537, ]`)
   *
   * Currently supported:
   *
   * - [EIP-2537](https://eips.ethereum.org/EIPS/eip-2537) - BLS12-381 precompiles
   */
  eips?: number[]
  /**
   * Directory to look for custom chains
   */
  customChainDir?: string
  /**
   * Initialize (in addition to the supported chains) with the selected
   * custom chains from customChainDir
   *
   * Please provide a list of strings matching a corresponding .json file
   * in customChainDir named by the chain name, e.g.`['myCustomChain']
   * to read the configuration parameters from a file named 'myCustomChain.json'
   */
  initCustomChains?: string[]
}

interface hardforkOptions {
  /** optional, only allow supported HFs (default: false) */
  onlySupported?: boolean
  /** optional, only active HFs (default: false) */
  onlyActive?: boolean
}

/**
 * Common class to access chain and hardfork parameters
 */
export default class Common {
  readonly DEFAULT_HARDFORK: string = 'istanbul'

  private _chainParams: Chain
  private _hardfork: string
  private _supportedHardforks: Array<string> = []
  private _eips: number[] = []

  /**
   * Creates a Common object for a custom chain, based on a standard one. It uses all the [[Chain]]
   * params from [[baseChain]] except the ones overridden in [[customChainParams]].
   *
   * @param baseChain The name (`mainnet`) or id (`1`) of a standard chain used to base the custom
   * chain params on.
   * @param customChainParams The custom parameters of the chain.
   * @param hardfork String identifier ('byzantium') for hardfork (optional)
   * @param supportedHardforks Limit parameter returns to the given hardforks (optional)
   */
  static forCustomChain(
    baseChain: string | number,
    customChainParams: Partial<Chain>,
    hardfork?: string,
    supportedHardforks?: Array<string>
  ): Common {
    const standardChainParams = Common._getChainParams(baseChain)

    return new Common({
      chain: {
        ...standardChainParams,
        ...customChainParams,
      },
      hardfork: hardfork,
      supportedHardforks: supportedHardforks,
    })
  }

  private static _getChainParams(chain: string | number): Chain {
    const initializedChains: any = _getInitializedChains()
    if (typeof chain === 'number') {
      if (initializedChains['names'][chain]) {
        const name: string = initializedChains['names'][chain]
        return initializedChains[name]
      }

      throw new Error(`Chain with ID ${chain} not supported`)
    }

    if (initializedChains[chain]) {
      return initializedChains[chain]
    }

    throw new Error(`Chain with name ${chain} not supported`)
  }

  /**
   * @constructor
   */
  constructor(opts: CommonOpts) {
    this._chainParams = this.setChain(opts.chain)
    this._hardfork = this.DEFAULT_HARDFORK
    if (opts.supportedHardforks) {
      this._supportedHardforks = opts.supportedHardforks
    }
    if (opts.hardfork) {
      this.setHardfork(opts.hardfork)
    }
    if (opts.eips) {
      this.setEIPs(opts.eips)
    }
  }

  /**
   * Sets the chain
   * @param chain String ('mainnet') or Number (1) chain
   *     representation. Or, a Dictionary of chain parameters for a private network.
   * @returns The dictionary with parameters set as chain
   */
  setChain(chain: string | number | object): any {
    if (typeof chain === 'number' || typeof chain === 'string') {
      this._chainParams = Common._getChainParams(chain)
    } else if (typeof chain === 'object') {
      const required = ['networkId', 'genesis', 'hardforks', 'bootstrapNodes']
      for (const param of required) {
        if ((<any>chain)[param] === undefined) {
          throw new Error(`Missing required chain parameter: ${param}`)
        }
      }
      this._chainParams = chain as Chain
    } else {
      throw new Error('Wrong input format')
    }
    return this._chainParams
  }

  /**
   * Sets the hardfork to get params for
   * @param hardfork String identifier (e.g. 'byzantium')
   */
  setHardfork(hardfork: string): void {
    if (!this._isSupportedHardfork(hardfork)) {
      throw new Error(`Hardfork ${hardfork} not set as supported in supportedHardforks`)
    }
    let changed = false
    for (const hfChanges of HARDFORK_CHANGES) {
      if (hfChanges[0] === hardfork) {
        this._hardfork = hardfork
        changed = true
      }
    }
    if (!changed) {
      throw new Error(`Hardfork with name ${hardfork} not supported`)
    }
  }

  /**
   * Sets a new hardfork based on the block number provided
   * @param blockNumber
   * @returns The name of the HF set
   */
  setHardforkByBlockNumber(blockNumber: number): string {
    let hardfork = 'chainstart'
    for (const hf of this.hardforks()) {
      const hardforkBlock = hf.block

      // Skip comparison for not applied HFs
      if (hardforkBlock === null) {
        continue
      }

      if (blockNumber >= hardforkBlock) {
        hardfork = hf.name
      }
    }
    this.setHardfork(hardfork)
    return hardfork
  }

  /**
   * Internal helper function to choose between hardfork set and hardfork provided as param
   * @param hardfork Hardfork given to function as a parameter
   * @returns Hardfork chosen to be used
   */
  _chooseHardfork(hardfork?: string | null, onlySupported: boolean = true): string {
    if (!hardfork) {
      hardfork = this._hardfork
    } else if (onlySupported && !this._isSupportedHardfork(hardfork)) {
      throw new Error(`Hardfork ${hardfork} not set as supported in supportedHardforks`)
    }
    return hardfork
  }

  /**
   * Internal helper function, returns the params for the given hardfork for the chain set
   * @param hardfork Hardfork name
   * @returns Dictionary with hardfork params
   */
  _getHardfork(hardfork: string): any {
    const hfs = this.hardforks()
    for (const hf of hfs) {
      if (hf['name'] === hardfork) return hf
    }
    throw new Error(`Hardfork ${hardfork} not defined for chain ${this.chainName()}`)
  }

  /**
   * Internal helper function to check if a hardfork is set to be supported by the library
   * @param hardfork Hardfork name
   * @returns True if hardfork is supported
   */
  _isSupportedHardfork(hardfork: string | null): boolean {
    if (this._supportedHardforks.length > 0) {
      for (const supportedHf of this._supportedHardforks) {
        if (hardfork === supportedHf) return true
      }
    } else {
      return true
    }
    return false
  }

  /**
   * Sets the active EIPs
   * @param eips
   */
  setEIPs(eips: number[] = []) {
    for (const eip of eips) {
      if (!(eip in EIPs)) {
        throw new Error(`${eip} not supported`)
      }
      const minHF = this.gteHardfork(EIPs[eip]['minimumHardfork'])
      if (!minHF) {
        throw new Error(
          `${eip} cannot be activated on hardfork ${this.hardfork()}, minimumHardfork: ${minHF}`
        )
      }
    }
    this._eips = eips
  }

  /**
   * Returns a parameter for the current chain setup
   *
   * If the parameter is present in an EIP, the EIP always takes precendence.
   * Otherwise the parameter if taken from the latest applied HF with
   * a change on the respective parameter.
   *
   * @param topic Parameter topic ('gasConfig', 'gasPrices', 'vm', 'pow')
   * @param name Parameter name (e.g. 'minGasLimit' for 'gasConfig' topic)
   * @returns The value requested or `null` if not found
   */
  param(topic: string, name: string): any {
    // TODO: consider the case that different active EIPs
    // can change the same parameter
    let value = null
    for (const eip of this._eips) {
      value = this.paramByEIP(topic, name, eip)
      if (value !== null) {
        return value
      }
    }
    return this.paramByHardfork(topic, name, this._hardfork)
  }

  /**
   * Returns the parameter corresponding to a hardfork
   * @param topic Parameter topic ('gasConfig', 'gasPrices', 'vm', 'pow')
   * @param name Parameter name (e.g. 'minGasLimit' for 'gasConfig' topic)
   * @param hardfork Hardfork name
   * @returns The value requested or `null` if not found
   */
  paramByHardfork(topic: string, name: string, hardfork: string): any {
    hardfork = this._chooseHardfork(hardfork)

    let value = null
    for (const hfChanges of HARDFORK_CHANGES) {
      // EIP-referencing HF file (e.g. berlin.json)
      if (hfChanges[1].hasOwnProperty('eips')) { // eslint-disable-line
        const hfEIPs = hfChanges[1]['eips']
        for (const eip of hfEIPs) {
          const valueEIP = this.paramByEIP(topic, name, eip)
          value = valueEIP !== null ? valueEIP : value
        }
        // Paramater-inlining HF file (e.g. istanbul.json)
      } else {
        if (!hfChanges[1][topic]) {
          throw new Error(`Topic ${topic} not defined`)
        }
        if (hfChanges[1][topic][name] !== undefined) {
          value = hfChanges[1][topic][name].v
        }
      }
      if (hfChanges[0] === hardfork) break
    }
    return value
  }

  /**
   * Returns a parameter corresponding to an EIP
   * @param topic Parameter topic ('gasConfig', 'gasPrices', 'vm', 'pow')
   * @param name Parameter name (e.g. 'minGasLimit' for 'gasConfig' topic)
   * @param eip Number of the EIP
   * @returns The value requested or `null` if not found
   */
  paramByEIP(topic: string, name: string, eip: number): any {
    if (!(eip in EIPs)) {
      throw new Error(`${eip} not supported`)
    }

    const eipParams = EIPs[eip]
    if (!(topic in eipParams)) {
      throw new Error(`Topic ${topic} not defined`)
    }
    if (eipParams[topic][name] === undefined) {
      return null
    }
    const value = eipParams[topic][name].v
    return value
  }

  /**
   * Returns a parameter for the hardfork active on block number
   * @param topic Parameter topic
   * @param name Parameter name
   * @param blockNumber Block number
   */
  paramByBlock(topic: string, name: string, blockNumber: number): any {
    const activeHfs = this.activeHardforks(blockNumber)
    const hardfork = activeHfs[activeHfs.length - 1]['name']
    return this.paramByHardfork(topic, name, hardfork)
  }

  /**
   * Checks if set or provided hardfork is active on block number
   * @param hardfork Hardfork name or null (for HF set)
   * @param blockNumber
   * @param opts Hardfork options (onlyActive unused)
   * @returns True if HF is active on block number
   */
  hardforkIsActiveOnBlock(
    hardfork: string | null,
    blockNumber: number,
    opts?: hardforkOptions
  ): boolean {
    opts = opts !== undefined ? opts : {}
    const onlySupported = opts.onlySupported === undefined ? false : opts.onlySupported
    hardfork = this._chooseHardfork(hardfork, onlySupported)
    const hfBlock = this.hardforkBlock(hardfork)
    if (hfBlock !== null && blockNumber >= hfBlock) return true
    return false
  }

  /**
   * Alias to hardforkIsActiveOnBlock when hardfork is set
   * @param blockNumber
   * @param opts Hardfork options (onlyActive unused)
   * @returns True if HF is active on block number
   */
  activeOnBlock(blockNumber: number, opts?: hardforkOptions): boolean {
    return this.hardforkIsActiveOnBlock(null, blockNumber, opts)
  }

  /**
   * Sequence based check if given or set HF1 is greater than or equal HF2
   * @param hardfork1 Hardfork name or null (if set)
   * @param hardfork2 Hardfork name
   * @param opts Hardfork options
   * @returns True if HF1 gte HF2
   */
  hardforkGteHardfork(
    hardfork1: string | null,
    hardfork2: string,
    opts?: hardforkOptions
  ): boolean {
    opts = opts !== undefined ? opts : {}
    const onlyActive = opts.onlyActive === undefined ? false : opts.onlyActive
    hardfork1 = this._chooseHardfork(hardfork1, opts.onlySupported)

    let hardforks
    if (onlyActive) {
      hardforks = this.activeHardforks(null, opts)
    } else {
      hardforks = this.hardforks()
    }

    let posHf1 = -1,
      posHf2 = -1
    let index = 0
    for (const hf of hardforks) {
      if (hf['name'] === hardfork1) posHf1 = index
      if (hf['name'] === hardfork2) posHf2 = index
      index += 1
    }
    return posHf1 >= posHf2
  }

  /**
   * Alias to hardforkGteHardfork when hardfork is set
   * @param hardfork Hardfork name
   * @param opts Hardfork options
   * @returns True if hardfork set is greater than hardfork provided
   */
  gteHardfork(hardfork: string, opts?: hardforkOptions): boolean {
    return this.hardforkGteHardfork(null, hardfork, opts)
  }

  /**
   * Checks if given or set hardfork is active on the chain
   * @param hardfork Hardfork name, optional if HF set
   * @param opts Hardfork options (onlyActive unused)
   * @returns True if hardfork is active on the chain
   */
  hardforkIsActiveOnChain(hardfork?: string | null, opts?: hardforkOptions): boolean {
    opts = opts !== undefined ? opts : {}
    const onlySupported = opts.onlySupported === undefined ? false : opts.onlySupported
    hardfork = this._chooseHardfork(hardfork, onlySupported)
    for (const hf of this.hardforks()) {
      if (hf['name'] === hardfork && hf['block'] !== null) return true
    }
    return false
  }

  /**
   * Returns the active hardfork switches for the current chain
   * @param blockNumber up to block if provided, otherwise for the whole chain
   * @param opts Hardfork options (onlyActive unused)
   * @return Array with hardfork arrays
   */
  activeHardforks(blockNumber?: number | null, opts?: hardforkOptions): Array<any> {
    opts = opts !== undefined ? opts : {}
    const activeHardforks = []
    const hfs = this.hardforks()
    for (const hf of hfs) {
      if (hf['block'] === null) continue
      if (blockNumber !== undefined && blockNumber !== null && blockNumber < hf['block']) break
      if (opts.onlySupported && !this._isSupportedHardfork(hf['name'])) continue

      activeHardforks.push(hf)
    }
    return activeHardforks
  }

  /**
   * Returns the latest active hardfork name for chain or block or throws if unavailable
   * @param blockNumber up to block if provided, otherwise for the whole chain
   * @param opts Hardfork options (onlyActive unused)
   * @return Hardfork name
   */
  activeHardfork(blockNumber?: number | null, opts?: hardforkOptions): string {
    opts = opts !== undefined ? opts : {}
    const activeHardforks = this.activeHardforks(blockNumber, opts)
    if (activeHardforks.length > 0) {
      return activeHardforks[activeHardforks.length - 1]['name']
    } else {
      throw new Error(`No (supported) active hardfork found`)
    }
  }

  /**
   * Returns the hardfork change block for hardfork provided or set
   * @param hardfork Hardfork name, optional if HF set
   * @returns Block number
   */
  hardforkBlock(hardfork?: string): number {
    hardfork = this._chooseHardfork(hardfork, false)
    return this._getHardfork(hardfork)['block']
  }

  /**
   * True if block number provided is the hardfork (given or set) change block
   * @param blockNumber Number of the block to check
   * @param hardfork Hardfork name, optional if HF set
   * @returns True if blockNumber is HF block
   */
  isHardforkBlock(blockNumber: number, hardfork?: string): boolean {
    hardfork = this._chooseHardfork(hardfork, false)
    return this.hardforkBlock(hardfork) === blockNumber
  }

  /**
   * Returns the change block for the next hardfork after the hardfork provided or set
   * @param hardfork Hardfork name, optional if HF set
   * @returns Block number or null if not available
   */
  nextHardforkBlock(hardfork?: string): number | null {
    hardfork = this._chooseHardfork(hardfork, false)
    const hfBlock = this.hardforkBlock(hardfork)
    // Next fork block number or null if none available
    // Logic: if accumulator is still null and on the first occurence of
    // a block greater than the current hfBlock set the accumulator,
    // pass on the accumulator as the final result from this time on
    const nextHfBlock = (this.hardforks() as any).reduce((acc: number, hf: any) => {
      return hf.block > hfBlock && acc === null ? hf.block : acc
    }, null)
    return nextHfBlock
  }

  /**
   * True if block number provided is the hardfork change block following the hardfork given or set
   * @param blockNumber Number of the block to check
   * @param hardfork Hardfork name, optional if HF set
   * @returns True if blockNumber is HF block
   */
  isNextHardforkBlock(blockNumber: number, hardfork?: string): boolean {
    hardfork = this._chooseHardfork(hardfork, false)
    return this.nextHardforkBlock(hardfork) === blockNumber
  }

  /**
   * Internal helper function to calculate a fork hash
   * @param hardfork Hardfork name
   * @returns Fork hash as hex string
   */
  _calcForkHash(hardfork: string) {
    const genesis = Buffer.from(this.genesis().hash.substr(2), 'hex')

    let hfBuffer = Buffer.alloc(0)
    let prevBlock: number | null = 0
    for (const hf of this.hardforks()) {
      const block = hf.block

      // Skip for chainstart (0), not applied HFs (null) and
      // when already applied on same block number HFs
      if (block !== 0 && block !== null && block !== prevBlock) {
        const hfBlockBuffer = Buffer.from(block.toString(16).padStart(16, '0'), 'hex')
        hfBuffer = Buffer.concat([hfBuffer, hfBlockBuffer])
      }

      if (hf.name === hardfork) break
      prevBlock = block
    }
    const inputBuffer = Buffer.concat([genesis, hfBuffer])

    // CRC32 delivers result as signed (negative) 32-bit integer,
    // convert to hex string
    const forkhash = new Number(crc32Buffer(inputBuffer) >>> 0).toString(16)
    return `0x${forkhash}`
  }

  /**
   * Returns an eth/64 compliant fork hash (EIP-2124)
   * @param hardfork Hardfork name, optional if HF set
   */
  forkHash(hardfork?: string) {
    hardfork = this._chooseHardfork(hardfork, false)
    const data = this._getHardfork(hardfork)
    if (data['block'] === null) {
      const msg = 'No fork hash calculation possible for non-applied or future hardfork'
      throw new Error(msg)
    }
    if (data['forkHash'] !== undefined) {
      return data['forkHash']
    }
    return this._calcForkHash(hardfork)
  }

  /**
   *
   * @param forkHash Fork hash as a hex string
   * @returns Array with hardfork data (name, block, forkHash)
   */
  hardforkForForkHash(forkHash: string): any | null {
    const resArray = this.hardforks().filter((hf: any) => {
      return hf.forkHash === forkHash
    })
    return resArray.length === 1 ? resArray[0] : null
  }

  /**
   * Returns the Genesis parameters of current chain
   * @returns Genesis dictionary
   */
  genesis(): any {
    return (<any>this._chainParams)['genesis']
  }

  /**
   * Returns the hardforks for current chain
   * @returns {Array} Array with arrays of hardforks
   */
  hardforks(): any {
    return (<any>this._chainParams)['hardforks']
  }

  /**
   * Returns bootstrap nodes for the current chain
   * @returns {Dictionary} Dict with bootstrap nodes
   */
  bootstrapNodes(): any {
    return (<any>this._chainParams)['bootstrapNodes']
  }

  /**
   * Returns the hardfork set
   * @returns Hardfork name
   */
  hardfork(): string {
    return this._hardfork
  }

  /**
   * Returns the Id of current chain
   * @returns chain Id
   */
  chainId(): number {
    return <number>(<any>this._chainParams)['chainId']
  }

  /**
   * Returns the name of current chain
   * @returns chain name (lower case)
   */
  chainName(): string {
    return (<any>this._chainParams)['name']
  }

  /**
   * Returns the Id of current network
   * @returns network Id
   */
  networkId(): number {
    return (<any>this._chainParams)['networkId']
  }

  /**
   * Returns the active EIPs
   * @returns List of EIPs
   */
  eips(): number[] {
    return this._eips
  }

  /**
   * Returns the consensus type of the network
   * Possible values: "pow"|"poa"
   */
  consensusType(): string {
    return (<any>this._chainParams)['consensus']['type']
  }

  /**
   * Returns the concrete consensus implementation
   * algorithm or protocol for the network
   * e.g. "ethash" for "pow" consensus type or
   * "clique" for "poa" consensus type
   */
  consensusAlgorithm(): string {
    return (<any>this._chainParams)['consensus']['algorithm']
  }
}
