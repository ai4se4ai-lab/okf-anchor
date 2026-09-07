# OKFAnchor contract

The Solidity side of `ANCHOR_PROVIDER=evm` (see [`docs/evm-anchor.md`](../docs/evm-anchor.md)
for the full provider design). `OKFAnchor.sol` stores exactly one compact commitment hash
per `(assetId, version)` — never the OKF bundle itself (CLAUDE.md §8).

Writes are gated by OpenZeppelin's `AccessControl` (`ANCHOR_ROLE`) — see
[Access control](#access-control-anchor_role) below for why, and how it maps onto
registered publishers such as MindPortalix build servers
(`docs/integration/mindportalix.md`).

`lib/forge-std` and `lib/openzeppelin-contracts` are already vendored (plain files, no
submodule) so `forge build`/`forge test` work with no setup beyond having Foundry itself
installed. Both were run for real against the Foundry docker image
(`ghcr.io/foundry-rs/foundry:v1.0.0`) while writing this — `forge test` (13/13 passing) and
a live deploy + anchor/verify round-trip against a real Anvil node, not just written and
assumed to work.

## Setup (only if `lib/forge-std` or `lib/openzeppelin-contracts` is ever removed)

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup   # installs forge/anvil/cast
cd contracts
forge install foundry-rs/forge-std --no-commit --no-git    # re-vendors the test/script helpers

# openzeppelin-contracts is vendored as a handful of files only (AccessControl +
# its dependencies), not the whole package — see remappings.txt for the mapping:
# @openzeppelin/contracts/access/AccessControl.sol, IAccessControl.sol,
# utils/Context.sol, utils/introspection/{ERC165,IERC165}.sol, at tag v5.1.0.
```

## Build & test

```bash
forge build
forge test -vvv
```

No local Foundry install? Use the same docker image CI uses:

```bash
docker run --rm -v "$PWD:/contracts" -w /contracts --entrypoint /bin/sh \
  ghcr.io/foundry-rs/foundry:v1.0.0 -c "forge build && forge test -vvv"
```

## Deploy to the local Anvil (`docker compose --profile chain up -d chain`)

```bash
EVM_SIGNER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  forge script script/DeployOKFAnchor.s.sol --rpc-url http://localhost:58545 --broadcast
```

The key above is Anvil's well-known, publicly documented dev account #0 — never use it
for anything with real funds. Copy the deployed address from the script's output into
`EVM_ANCHOR_CONTRACT_ADDRESS` in `.env`.

Root-level convenience scripts wrap the same commands: `pnpm contracts:build`,
`pnpm contracts:test`, `pnpm contracts:deploy:anvil`.

## Access control (`ANCHOR_ROLE`)

`anchor()` is restricted to addresses holding `ANCHOR_ROLE` (OpenZeppelin `AccessControl`).
Without this, any address could call `anchor()` first for an `(assetId, version)` a
legitimate publisher hasn't written yet — with a garbage commitment and CID — permanently
squatting that slot, since a second write always reverts (`AlreadyAnchored`). That is a
griefing vector the untrusted-input rules in CLAUDE.md §3 require closing.

The deployer is granted both `DEFAULT_ADMIN_ROLE` and `ANCHOR_ROLE` in the constructor, so
the default single-signer setup above (`EVM_SIGNER_PRIVATE_KEY` both deploys and anchors)
needs no extra step. To authorize additional publisher signers — e.g. giving each
registered build server (MindPortalix or otherwise; see
`docs/integration/mindportalix.md`) its own EVM key instead of anchoring everything through
one shared backend key — grant them the role from an admin account:

```bash
cast send $EVM_ANCHOR_CONTRACT_ADDRESS \
  "grantRole(bytes32,address)" \
  "$(cast keccak "ANCHOR_ROLE")" "$BUILD_SERVER_SIGNER_ADDRESS" \
  --rpc-url http://localhost:58545 --private-key $ADMIN_PRIVATE_KEY
```

`getAnchor()` (reads) stays unrestricted — independent, unauthenticated verification
(`GET /api/public/assets/:id/verify`) is a design requirement, not something to gate.
