import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// const deployKey = process.env["DEPLOY_KEY"];
// if(!deployKey) throw new Error("missing deploy key in environment vars");

const config: HardhatUserConfig = {
  solidity: "0.8.9",
  // networks: {
  //   goerli: {
  //     url: "https://rpc.ankr.com/eth_goerli",
  //     accounts: [deployKey]
  //   }
  // }
};

export default config;
