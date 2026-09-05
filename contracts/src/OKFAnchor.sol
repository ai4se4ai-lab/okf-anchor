// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title OKFAnchor
/// @notice The on-chain trust anchor for OKF Anchor (CLAUDE.md §2, §8; skill:
/// okf-blockchain-anchor). Stores exactly one thing per (assetId, version): a
/// compact commitment hash plus a pointer back to the content-addressed bundle.
/// It never holds the OKF bundle, the derived knowledge graph, or any PII — the
/// off-chain `Commitment` (packages/okf-core/src/commitment.ts) already binds
/// canonicalHash, merkleRoot, graphHash, manifestHash and storageCid into the
/// single `commitment` hash written here, so those fields are not duplicated
/// on-chain. `verify()` re-derives that same hash from the canonical bundle and
/// compares it against what this contract returns — it never trusts a stored
/// copy of the hash.
///
/// Uses OpenZeppelin's `AccessControl` (standard, audited library — CLAUDE.md §4)
/// to gate writes: only addresses holding `ANCHOR_ROLE` may call `anchor()`.
/// Without this, any address could write a garbage commitment for an assetId a
/// legitimate publisher hasn't anchored yet, permanently squatting that
/// `(assetId, version)` pair since a second write always reverts — a griefing
/// vector against untrusted callers (CLAUDE.md §3). The `DEFAULT_ADMIN_ROLE`
/// (held by the deployer) grants `ANCHOR_ROLE` to the OKF Anchor backend's EVM
/// signer address(es) — e.g. one key per registered MindPortalix-style build
/// server (`docs/integration/mindportalix.md`) — so on-chain write permission
/// mirrors the off-chain build-server credential model. Reads (`getAnchor`)
/// stay unrestricted: independent, unauthenticated verification is a design
/// requirement (`GET /api/public/assets/:id/verify`).
contract OKFAnchor is AccessControl {
    bytes32 public constant ANCHOR_ROLE = keccak256("ANCHOR_ROLE");

    struct Anchor {
        bytes32 commitment;
        string bundleCid;
        address publisher;
        uint256 timestamp;
    }

    /// assetId => version => Anchor. Keyed by version so every AssetVersion
    /// gets its own immutable anchor — a changed asset publishes a new version
    /// rather than overwriting one (CLAUDE.md §3).
    mapping(bytes32 => mapping(uint256 => Anchor)) private _anchors;

    event Anchored(
        bytes32 indexed assetId,
        uint256 version,
        bytes32 commitment,
        string bundleCid,
        address indexed publisher
    );

    error AlreadyAnchored(bytes32 assetId, uint256 version);

    /// @notice Deployer becomes the role admin and is also granted `ANCHOR_ROLE`
    /// directly, so a single-signer deployment (the default in `docs/evm-anchor.md`)
    /// works with no extra setup step. Additional publisher addresses (e.g. a
    /// per-build-server signer) can be authorized afterwards via `grantRole`.
    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ANCHOR_ROLE, msg.sender);
    }

    /// @notice Anchor a commitment for (assetId, version). Reverts if this
    /// exact pair was already anchored: an anchor is immutable once written,
    /// so overwrite attempts must fail loud rather than silently succeed.
    /// Restricted to `ANCHOR_ROLE` holders — see the contract-level note above.
    function anchor(bytes32 assetId, uint256 version, bytes32 commitment, string calldata bundleCid)
        external
        onlyRole(ANCHOR_ROLE)
    {
        if (_anchors[assetId][version].timestamp != 0) {
            revert AlreadyAnchored(assetId, version);
        }
        _anchors[assetId][version] =
            Anchor({commitment: commitment, bundleCid: bundleCid, publisher: msg.sender, timestamp: block.timestamp});
        emit Anchored(assetId, version, commitment, bundleCid, msg.sender);
    }

    /// @notice Read the anchor for (assetId, version). Returns a zero-valued
    /// struct (`timestamp == 0`) when nothing has been anchored yet — callers
    /// must check `timestamp` rather than treating a zero commitment as valid.
    /// Deliberately unrestricted: verification must work for anyone, unauthenticated.
    function getAnchor(bytes32 assetId, uint256 version) external view returns (Anchor memory) {
        return _anchors[assetId][version];
    }
}
