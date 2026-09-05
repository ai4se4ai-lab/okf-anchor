// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {OKFAnchor} from "../src/OKFAnchor.sol";

/// Deploys OKFAnchor to whatever `--rpc-url` is passed (Anvil in dev). Reads
/// the deployer key from `EVM_SIGNER_PRIVATE_KEY` — the same dev-only throwaway
/// key `EvmAnchorProvider` uses to submit anchor transactions, never a
/// production key (CLAUDE.md §3, skill: okf-blockchain-anchor).
contract DeployOKFAnchor is Script {
    function run() external returns (OKFAnchor) {
        uint256 deployerKey = vm.envUint("EVM_SIGNER_PRIVATE_KEY");
        vm.startBroadcast(deployerKey);
        OKFAnchor deployed = new OKFAnchor();
        vm.stopBroadcast();
        console.log("OKFAnchor deployed at:", address(deployed));
        return deployed;
    }
}
