// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {OKFAnchor} from "../src/OKFAnchor.sol";

contract OKFAnchorTest is Test {
    OKFAnchor internal okfAnchor;

    function setUp() public {
        okfAnchor = new OKFAnchor();
    }

    function test_AnchorStoresCommitment() public {
        bytes32 assetId = keccak256("asset-1");
        bytes32 commitment = keccak256("commitment-1");
        okfAnchor.anchor(assetId, 1, commitment, "bafybeigdyrztest");

        OKFAnchor.Anchor memory stored = okfAnchor.getAnchor(assetId, 1);
        assertEq(stored.commitment, commitment);
        assertEq(stored.bundleCid, "bafybeigdyrztest");
        assertEq(stored.publisher, address(this));
        assertGt(stored.timestamp, 0);
    }

    function test_RevertWhen_ReAnchoringSameVersion() public {
        bytes32 assetId = keccak256("asset-1");
        okfAnchor.anchor(assetId, 1, keccak256("c1"), "cid1");

        vm.expectRevert(abi.encodeWithSelector(OKFAnchor.AlreadyAnchored.selector, assetId, uint256(1)));
        okfAnchor.anchor(assetId, 1, keccak256("c2"), "cid2");
    }

    function test_ReAnchoringIdenticalCommitmentStillReverts() public {
        // The contract itself has no notion of "identical content" idempotency —
        // that check lives in EvmAnchorProvider.anchor() before it ever submits a
        // transaction. At the contract level, a second write to the same
        // (assetId, version) always reverts, identical commitment or not.
        bytes32 assetId = keccak256("asset-1");
        bytes32 commitment = keccak256("c1");
        okfAnchor.anchor(assetId, 1, commitment, "cid1");

        vm.expectRevert(abi.encodeWithSelector(OKFAnchor.AlreadyAnchored.selector, assetId, uint256(1)));
        okfAnchor.anchor(assetId, 1, commitment, "cid1");
    }

    function test_NewVersionGetsItsOwnAnchor() public {
        bytes32 assetId = keccak256("asset-1");
        okfAnchor.anchor(assetId, 1, keccak256("c1"), "cid1");
        okfAnchor.anchor(assetId, 2, keccak256("c2"), "cid2");

        assertEq(okfAnchor.getAnchor(assetId, 1).commitment, keccak256("c1"));
        assertEq(okfAnchor.getAnchor(assetId, 2).commitment, keccak256("c2"));
    }

    function test_DifferentAssetsDoNotCollide() public {
        bytes32 assetA = keccak256("asset-a");
        bytes32 assetB = keccak256("asset-b");
        okfAnchor.anchor(assetA, 1, keccak256("ca"), "cida");
        okfAnchor.anchor(assetB, 1, keccak256("cb"), "cidb");

        assertEq(okfAnchor.getAnchor(assetA, 1).commitment, keccak256("ca"));
        assertEq(okfAnchor.getAnchor(assetB, 1).commitment, keccak256("cb"));
    }

    function test_UnknownAnchorReturnsZeroTimestamp() public view {
        OKFAnchor.Anchor memory stored = okfAnchor.getAnchor(keccak256("nope"), 1);
        assertEq(stored.timestamp, 0);
        assertEq(stored.commitment, bytes32(0));
    }

    function test_RevertWhen_UnauthorizedCallerAnchors() public {
        address stranger = address(0xBAD);
        bytes32 anchorRole = okfAnchor.ANCHOR_ROLE();

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, anchorRole));
        okfAnchor.anchor(keccak256("asset-1"), 1, keccak256("c1"), "cid1");
    }

    function test_DeployerHoldsAnchorRoleAndAdminRole() public view {
        assertTrue(okfAnchor.hasRole(okfAnchor.ANCHOR_ROLE(), address(this)));
        assertTrue(okfAnchor.hasRole(okfAnchor.DEFAULT_ADMIN_ROLE(), address(this)));
    }

    function test_AdminCanGrantAnchorRoleToAnotherPublisher() public {
        address buildServerSigner = address(0xCAFE);
        okfAnchor.grantRole(okfAnchor.ANCHOR_ROLE(), buildServerSigner);

        vm.prank(buildServerSigner);
        okfAnchor.anchor(keccak256("asset-1"), 1, keccak256("c1"), "cid1");

        assertEq(okfAnchor.getAnchor(keccak256("asset-1"), 1).publisher, buildServerSigner);
    }

    function test_RevertWhen_NonAdminGrantsAnchorRole() public {
        address stranger = address(0xBAD);
        bytes32 adminRole = okfAnchor.DEFAULT_ADMIN_ROLE();
        bytes32 anchorRole = okfAnchor.ANCHOR_ROLE();

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, adminRole));
        okfAnchor.grantRole(anchorRole, address(0xCAFE));
    }

    function test_RevokedPublisherCanNoLongerAnchor() public {
        bytes32 anchorRole = okfAnchor.ANCHOR_ROLE();
        okfAnchor.revokeRole(anchorRole, address(this));

        vm.expectRevert(abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, address(this), anchorRole));
        okfAnchor.anchor(keccak256("asset-1"), 1, keccak256("c1"), "cid1");
    }

    function test_EmitsAnchoredEvent() public {
        bytes32 assetId = keccak256("asset-1");
        bytes32 commitment = keccak256("c1");
        vm.expectEmit(true, true, false, true, address(okfAnchor));
        emit OKFAnchor.Anchored(assetId, 1, commitment, "cid1", address(this));
        okfAnchor.anchor(assetId, 1, commitment, "cid1");
    }

    function test_PublisherIsMsgSender() public {
        bytes32 assetId = keccak256("asset-1");
        address publisher = address(0xBEEF);
        okfAnchor.grantRole(okfAnchor.ANCHOR_ROLE(), publisher);

        vm.prank(publisher);
        okfAnchor.anchor(assetId, 1, keccak256("c1"), "cid1");

        assertEq(okfAnchor.getAnchor(assetId, 1).publisher, publisher);
    }
}
