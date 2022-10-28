import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: "0.8.17",
  // networks: {
  //   goerli: {
  //     url: "https://rpc.ankr.com/eth_goerli",
  //     accounts: [deployKey]
  //   }
  // }
  networks: {
    mumbai: {
      url: "https://matic-mumbai.chainstacklabs.com",
      accounts: process.env["DEPLOY_KEY"] ? [process.env["DEPLOY_KEY"]] : []
    }
  }
};

export default config;
