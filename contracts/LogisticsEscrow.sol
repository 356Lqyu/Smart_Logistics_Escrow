// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract LogisticsEscrow {

    enum AgreementStatus {
        Created,
        Funded,
        InProgress,
        Completed,
        Refunded,
        Cancelled,
        Expired
    }

    enum Priority {
        Normal,
        Express,
        Urgent
    }

    struct Milestone {
        string checkpoint;
        uint percentage;
        bool completed;
        bool verified;
    }

    struct Agreement {
        uint agreementId;
        string referenceNo;
        address payable shipper;
        address payable carrier;
        string shipmentDetails;
        string notes;
        uint payloadValue;
        uint escrowAmount;
        uint deadline;
        uint createdTime;
        Priority priority;
        AgreementStatus status;
        uint currentMilestone;
    }

    uint public agreementCounter;

    mapping(uint => Agreement) private agreements;
    mapping(uint => Milestone[]) public agreementMilestones;
    mapping(bytes32 => bool) private agreementHashes;

    event AgreementCreated(
        uint agreementId,
        address shipper,
        uint escrowAmount
    );

    event EscrowFunded(
        uint agreementId,
        uint amount
    );

    event AgreementAccepted(
        uint agreementId,
        address carrier
    );

    event AgreementCancelled(uint agreementId);

    event AgreementExpired(uint agreementId);

    constructor() {

    }

    function getAgreementBasic(uint id)
        external
        view
        returns (
            uint agreementId,
            string memory referenceNo,
            address shipper,
            address carrier,
            uint escrowAmount,
            AgreementStatus status
        )
    {
        Agreement storage a = agreements[id];

        return (
            a.agreementId,
            a.referenceNo,
            a.shipper,
            a.carrier,
            a.escrowAmount,
            a.status
        );
    }

    function createAgreement(
        string memory shipmentDetails,
        string memory notes,
        uint payloadValue,
        uint escrowAmount,
        uint deadline,
        Priority priority,
        string[] memory checkpoints,
        uint[] memory percentages
    ) public returns (uint256) {
        // 1. Minimum escrow validation
        require(
            escrowAmount >= 0.01 ether,
            "Minimum escrow is 0.01 ETH"
        );

        // 2. Deadline validation
        require(
            deadline > block.timestamp,
            "Invalid deadline"
        );

        // 3. Milestones array length matching
        require(
            checkpoints.length == percentages.length,
            "Invalid milestones"
        );

        require(
            checkpoints.length > 0,
            "At least one milestone required"
        );

        require(
            payloadValue > 0,
            "Payload value must be greater than zero"
        );

        require(
            bytes(shipmentDetails).length > 0,
            "Shipment details required"
        );

        // 4. Percentage sum validation (must equal 100%)
        uint256 total = 0;
        for (uint256 i = 0; i < percentages.length; i++) {
            total += percentages[i];
        }
        require(total == 100, "Percentages must equal 100");

        // Duplicate agreement check based on unique input signatures
        bytes32 agreementHash = keccak256(
            abi.encodePacked(
            msg.sender,
            keccak256(bytes(shipmentDetails)),
            payloadValue,
            escrowAmount,
            deadline
            )
        );

        require(!agreementHashes[agreementHash], "Duplicate agreement detected");
        agreementHashes[agreementHash] = true;

        // Increment agreement counter to derive unique ID
        agreementCounter++;
        uint256 newId = agreementCounter;

        // Generate auto-formatted reference number (e.g., LG-2026-0001)
        string memory refNo = _generateReferenceNo(newId);

        // 5. Save agreement details
        agreements[newId] = Agreement({
            agreementId: newId,
            referenceNo: refNo,
            shipper: payable(msg.sender),
            carrier: payable(address(0)),
            shipmentDetails: shipmentDetails,
            notes: notes,
            payloadValue: payloadValue,
            escrowAmount: escrowAmount,
            deadline: deadline,
            createdTime: block.timestamp,
            priority: priority,
            status: AgreementStatus.Created,
            currentMilestone: 0
        });

        // 6. Save milestones
        for (uint256 i = 0; i < checkpoints.length; i++) {
            agreementMilestones[newId].push(
                Milestone({
                    checkpoint: checkpoints[i],
                    percentage: percentages[i],
                    completed: false,
                    verified: false
                })
            );
        }

        // 7. Emit creation event
        emit AgreementCreated(
            newId,
            msg.sender,
            escrowAmount
        );

        return newId;
    }

    /// @dev Internal helper function to format reference strings like "LG-2026-0001"
    function _generateReferenceNo(uint256 id) internal pure returns (string memory) {
        string memory paddedId;
        if (id < 10) {
            paddedId = string(abi.encodePacked("000", _uintToStr(id)));
        } else if (id < 100) {
            paddedId = string(abi.encodePacked("00", _uintToStr(id)));
        } else if (id < 1000) {
            paddedId = string(abi.encodePacked("0", _uintToStr(id)));
        } else {
            paddedId = _uintToStr(id);
        }

        return string(abi.encodePacked("LG-2026-", paddedId));
    }

    /// @dev Helper to convert uint256 to string for reference formatting
    function _uintToStr(uint256 _i) internal pure returns (string memory _uintAsString) {
        if (_i == 0) {
            return "0";
        }
        uint256 temp = _i;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (_i != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(_i % 10)));
            _i /= 10;
        }
        return string(buffer);
    }

    /// @notice Funds the escrow for a specific agreement
    /// @param agreementId The ID of the agreement to fund
    function fundEscrow(uint256 agreementId) external payable {
        Agreement storage agreement = agreements[agreementId];

        require(agreement.agreementId != 0, "Agreement does not exist");
        require(msg.sender == agreement.shipper, "Only shipper can fund escrow");
        require(
            agreement.status == AgreementStatus.Created,
            "Agreement is not in Created status"
        );
        require(
            block.timestamp <= agreement.deadline,
            "Agreement deadline has passed"
        );
        require(
            msg.value == agreement.escrowAmount,
            "Incorrect ETH amount sent"
        );

        agreement.status = AgreementStatus.Funded;

        emit EscrowFunded(agreementId, msg.value);
    }

    /// @notice Allows a registered carrier to accept a funded logistics agreement
    /// @param agreementId The ID of the agreement to accept
    function acceptAgreement(uint256 agreementId) external {
        Agreement storage agreement = agreements[agreementId];

        require(agreement.agreementId != 0, "Agreement does not exist");
        require(
            agreement.status == AgreementStatus.Funded,
            "Agreement is not in Funded status"
        );
        require(
            block.timestamp <= agreement.deadline,
            "Agreement deadline has passed"
        );
        require(
            msg.sender != agreement.shipper,
            "Shipper cannot act as carrier"
        );

        agreement.carrier = payable(msg.sender);
        agreement.status = AgreementStatus.InProgress;

        emit AgreementAccepted(agreementId, msg.sender);
    }

    /// @notice Cancels an unfunded agreement
    /// @param agreementId The ID of the agreement to cancel
    function cancelAgreement(uint256 agreementId) external {
        Agreement storage agreement = agreements[agreementId];

        require(agreement.agreementId != 0, "Agreement does not exist");
        require(msg.sender == agreement.shipper, "Only shipper can cancel");
        require(
            agreement.status == AgreementStatus.Created,
            "Cannot cancel an active or finalized agreement"
        );

        agreement.status = AgreementStatus.Cancelled;

        emit AgreementCancelled(agreementId);
    }

    /// @notice Marks an agreement as expired after deadline and refunds the shipper if funded
    /// @param agreementId The ID of the agreement to expire
    function expireAgreement(uint256 agreementId) external {
        Agreement storage agreement = agreements[agreementId];

        require(agreement.agreementId != 0, "Agreement does not exist");
        require(
            block.timestamp > agreement.deadline,
            "Agreement deadline has not passed yet"
        );
        require(
            agreement.status == AgreementStatus.Created || 
            agreement.status == AgreementStatus.Funded || 
            agreement.status == AgreementStatus.InProgress,
            "Agreement cannot be expired from current status"
        );

        AgreementStatus previousStatus = agreement.status;
        agreement.status = AgreementStatus.Expired;

        if (previousStatus == AgreementStatus.Funded || previousStatus == AgreementStatus.InProgress) {
            uint256 refundAmount = agreement.escrowAmount;
            agreement.escrowAmount = 0; // Prevent re-entrancy issues

            (bool success, ) = agreement.shipper.call{value: refundAmount}("");
            require(success, "Refund transfer failed");
        }

        emit AgreementExpired(agreementId);
    }
}