// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract LogisticsEscrow {

    // ===============================
    // USER REGISTRATION
    // ===============================

    enum UserRole {
        None,
        Shipper,
        Carrier
    }

    struct User {
        string name;
        UserRole role;
        bool registered;
    }

    mapping(address => User) public users;

    event UserRegistered(
        address indexed user,
        UserRole role
    );


    // ===============================
    // AGREEMENT ENUMS
    // ===============================

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


    // ===============================
    // MILESTONE STRUCT
    // ===============================

    struct Milestone {

        string checkpoint;

        uint percentage;

        bool completed;

        bool verified;
    }


    // ===============================
    // AGREEMENT STRUCT
    // ===============================

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


    // ===============================
    // STORAGE
    // ===============================

    uint public agreementCounter;


    mapping(uint => Agreement) private agreements;


    mapping(uint => Milestone[]) public agreementMilestones;


    mapping(bytes32 => bool) private agreementHashes;



    // ===============================
    // EVENTS
    // ===============================

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


    event AgreementCancelled(
        uint agreementId
    );


    event AgreementExpired(
        uint agreementId
    );



    // ===============================
    // USER REGISTRATION
    // ===============================

    function register(
        string memory _name,
        UserRole _role
    ) external {


        require(
            !users[msg.sender].registered,
            "Wallet already registered"
        );


        require(
            bytes(_name).length > 0,
            "Name is required"
        );


        require(
            _role == UserRole.Shipper ||
            _role == UserRole.Carrier,
            "Invalid role"
        );


        users[msg.sender] = User({

            name: _name,

            role: _role,

            registered: true

        });


        emit UserRegistered(
            msg.sender,
            _role
        );

    }



    // ===============================
    // VIEW AGREEMENT DETAILS
    // ===============================

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




    // ===============================
    // CREATE AGREEMENT
    // ===============================

    function createAgreement(

        string memory shipmentDetails,

        string memory notes,

        uint payloadValue,

        uint escrowAmount,

        uint deadline,

        Priority priority,

        string[] memory checkpoints,

        uint[] memory percentages

    )
    public
    returns(uint256)
    {


        require(
            escrowAmount >= 0.01 ether,
            "Minimum escrow is 0.01 ETH"
        );


        require(
            deadline > block.timestamp,
            "Invalid deadline"
        );


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



        uint total = 0;


        for(uint i = 0; i < percentages.length; i++){

            total += percentages[i];

        }


        require(
            total == 100,
            "Percentages must equal 100"
        );



        bytes32 agreementHash = keccak256(

            abi.encodePacked(

                msg.sender,

                keccak256(bytes(shipmentDetails)),

                payloadValue,

                escrowAmount,

                deadline

            )

        );


        require(
            !agreementHashes[agreementHash],
            "Duplicate agreement detected"
        );


        agreementHashes[agreementHash] = true;



        agreementCounter++;


        uint newId = agreementCounter;



        string memory refNo = _generateReferenceNo(newId);



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



        for(uint i = 0; i < checkpoints.length; i++){


            agreementMilestones[newId].push(

                Milestone({

                    checkpoint: checkpoints[i],

                    percentage: percentages[i],

                    completed:false,

                    verified:false

                })

            );

        }



        emit AgreementCreated(

            newId,

            msg.sender,

            escrowAmount

        );


        return newId;

    }




    // ===============================
    // GENERATE REFERENCE NUMBER
    // ===============================


    function _generateReferenceNo(uint id)
        internal
        pure
        returns(string memory)
    {

        string memory paddedId;


        if(id < 10){

            paddedId = string(
                abi.encodePacked(
                    "000",
                    _uintToStr(id)
                )
            );

        }
        else if(id < 100){

            paddedId = string(
                abi.encodePacked(
                    "00",
                    _uintToStr(id)
                )
            );

        }
        else if(id < 1000){

            paddedId = string(
                abi.encodePacked(
                    "0",
                    _uintToStr(id)
                )
            );

        }
        else{

            paddedId = _uintToStr(id);

        }



        return string(
            abi.encodePacked(
                "LG-2026-",
                paddedId
            )
        );

    }



    function _uintToStr(uint _i)
        internal
        pure
        returns(string memory)
    {

        if(_i == 0){

            return "0";

        }


        uint temp = _i;

        uint digits;



        while(temp != 0){

            digits++;

            temp /= 10;

        }



        bytes memory buffer = new bytes(digits);



        while(_i != 0){

            digits--;

            buffer[digits] = bytes1(
                uint8(
                    48 + uint(_i % 10)
                )
            );

            _i /= 10;

        }


        return string(buffer);

    }





    // ===============================
    // FUND ESCROW
    // ===============================


    function fundEscrow(uint agreementId)
        external
        payable
    {

        Agreement storage agreement = agreements[agreementId];


        require(
            agreement.agreementId != 0,
            "Agreement does not exist"
        );


        require(
            msg.sender == agreement.shipper,
            "Only shipper can fund escrow"
        );


        require(
            agreement.status == AgreementStatus.Created,
            "Agreement is not Created"
        );


        require(
            block.timestamp <= agreement.deadline,
            "Deadline passed"
        );


        require(
            msg.value == agreement.escrowAmount,
            "Incorrect ETH amount"
        );



        agreement.status = AgreementStatus.Funded;



        emit EscrowFunded(
            agreementId,
            msg.value
        );

    }





    // ===============================
    // ACCEPT AGREEMENT
    // ===============================


    function acceptAgreement(uint agreementId)
        external
    {

        Agreement storage agreement = agreements[agreementId];


        require(
            agreement.agreementId != 0,
            "Agreement does not exist"
        );


        require(
            agreement.status == AgreementStatus.Funded,
            "Agreement not funded"
        );


        require(
            msg.sender != agreement.shipper,
            "Shipper cannot be carrier"
        );



        agreement.carrier = payable(msg.sender);


        agreement.status = AgreementStatus.InProgress;



        emit AgreementAccepted(

            agreementId,

            msg.sender

        );

    }





    // ===============================
    // CANCEL AGREEMENT
    // ===============================


    function cancelAgreement(uint agreementId)
        external
    {

        Agreement storage agreement = agreements[agreementId];


        require(
            agreement.agreementId != 0,
            "Agreement does not exist"
        );


        require(
            msg.sender == agreement.shipper,
            "Only shipper can cancel"
        );


        require(
            agreement.status == AgreementStatus.Created,
            "Cannot cancel"
        );


        agreement.status = AgreementStatus.Cancelled;



        emit AgreementCancelled(agreementId);

    }





    // ===============================
    // EXPIRE AGREEMENT
    // ===============================


    function expireAgreement(uint agreementId)
        external
    {

        Agreement storage agreement = agreements[agreementId];


        require(
            agreement.agreementId != 0,
            "Agreement does not exist"
        );


        require(
            block.timestamp > agreement.deadline,
            "Deadline not passed"
        );



        require(

            agreement.status == AgreementStatus.Created ||
            agreement.status == AgreementStatus.Funded ||
            agreement.status == AgreementStatus.InProgress,

            "Cannot expire"

        );



        AgreementStatus previousStatus = agreement.status;



        agreement.status = AgreementStatus.Expired;



        if(
            previousStatus == AgreementStatus.Funded ||
            previousStatus == AgreementStatus.InProgress
        ){

            uint amount = agreement.escrowAmount;


            agreement.escrowAmount = 0;



            (bool success,) = agreement.shipper.call{
                value: amount
            }("");



            require(
                success,
                "Refund failed"
            );

        }



        emit AgreementExpired(agreementId);

    }

}