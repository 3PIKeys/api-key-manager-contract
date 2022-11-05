import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: "0.8.17",
  networks: {
    mumbai: {
      url: "https://matic-mumbai.chainstacklabs.com",
      accounts: process.env["DEPLOY_KEY"] ? [process.env["DEPLOY_KEY"]] : []
    },
    polygon: {
      url: "https://polygon-rpc.com",
      accounts: process.env["DEPLOY_KEY"] ? [process.env["DEPLOY_KEY"]] : []
    },
    optimism: {
      url: "https://mainnet.optimism.io",
      accounts: process.env["DEPLOY_KEY"] ? [process.env["DEPLOY_KEY"]] : []
    }
  }
};

export default config;
