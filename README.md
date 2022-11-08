# API Key Manager Contract

This is the core component to 3PI's trustless, on-chain API key management protocol that handles API key subscriptions and active key validation.

Our deployment-ready API Key Management Contract is EVM compatible and written in Solidity, with a security-first approach following industry best practices. Once deployed, this contract acts as the decentralized key validation authority all while seamlessly processing client subscription payments.

## Install

Install the project dependencies with `npm i`.

## Deployment

1. Add the target network to `hardhat.config.ts`
2. Set two environment variables:
    1. `DEPLOY_KEY` -> `0x64a...` (your deployment private key)
    2. `ERC20` -> `0x721...` (the address of the erc20 token that the contract will accept for payment)
3. Run `npx hardhat run --network <network name from hardhat.config.ts> srcipts/deploy.ts`

## Testing

Run available tests for the contract code with the following:
```
npx hardhat test
```

*or*

```
npm hardhat coverage
```
