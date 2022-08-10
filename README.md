# API Key Manager Contract

A solidity contract that allows API users to trustlessly buy and manage their own API keys.

Our deployment-ready API Key Management Contract is EVM compatible and written in Solidity, with a security-first approach following industry best practices. Once deployed, this contract acts as the decentralized key validation authority all while seamlessly processing client subscription payments.

## Install

Install the project dependencies with `npm i`.

## Deployment

Deploy the contract by adding the target network to hardhat.config.ts and running:
```
npx hardhat run scripts/deploy.ts
```

*The APIKeyManager.sol contract is functional, but still under development and not fully tested. Please use caution when deploying to live environments.*

## Testing

Run available tests for the contract code with the following:
```
npx hardhat test
```
