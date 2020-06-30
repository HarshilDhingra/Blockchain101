const Dynachain= require('./blockwork');
const express = require('express');
const bodyParser=require('body-parser');
const app= express();
const uuid=require('uuid/v1');
const blockaddress= uuid().split('-').join('');
const rp= require('request-promise');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended:false}));
const port=process.argv[2];
const dynachain= new Dynachain();
app.get('/blockchain', function(req,res){
    res.send(dynachain);  
})
app.post('/transaction', function(req,res){
    const newTransaction=req.body;
    const blockindex=dynachain.addTransactionToPendingTransactions(newTransaction);
    res.json({note: "this block will be added successfully"+blockindex});
});
app.post('/transaction/broadcast', function(req, res) {
	const newTransaction =dynachain.createNewTransaction(req.body.amount, req.body.sender, req.body.recipient);
	dynachain.addTransactionToPendingTransactions(newTransaction);

	const requestPromises = [];
	dynachain.networkNodes.forEach(networkNodeUrl => {
		const requestOptions = {
			uri: networkNodeUrl + '/transaction',
			method: 'POST',
			body: newTransaction,
			json: true
		};

		requestPromises.push(rp(requestOptions));
    });
app.get('/consensus', function(req, res) {
        const requestPromises = [];
        dynachain.networkNodes.forEach(networkNodeUrl => {
            const requestOptions = {
                uri: networkNodeUrl + '/blockchain',
                method: 'GET',
                json: true
            };
    
            requestPromises.push(rp(requestOptions));
        });
    
        Promise.all(requestPromises)
        .then(blockchains => {
            const currentChainLength = dynachain.chain.length;
            let maxChainLength = currentChainLength;
            let newLongestChain = null;
            let newPendingTransactions = null;
    
            blockchains.forEach(blockchain => {
                if (blockchain.chain.length > maxChainLength) {
                    maxChainLength = blockchain.chain.length;
                    newLongestChain = blockchain.chain;
                    newPendingTransactions = blockchain.pendingTransactions;
                };
            });
    
    
            if (!newLongestChain || (newLongestChain && !dynachain.chainIsValid(newLongestChain))) {
                res.json({
                    note: 'Current chain has not been replaced.',
                    chain: dynachain.chain
                });
            }
            else {
                dynachain.chain = newLongestChain;
                dynachain.pendingTransactions = newPendingTransactions;
                res.json({
                    note: 'This chain has been replaced.',
                    chain: dynachain.chain
                });
            }
        });
    });

	Promise.all(requestPromises)
	.then(data => {
		res.json({ note: 'Transaction created and broadcast successfully.' });
	});
});
app.get('/mine', function(req, res) {
	const lastBlock = dynachain.getLastBlock();
	const previousBlockHash = lastBlock['hash'];
	const currentBlockData = {
		transactions: dynachain.pendingTransactions,
		index: lastBlock['index'] + 1
	};
	const nonce = dynachain.proofOfWork(previousBlockHash, currentBlockData);
	const blockHash = dynachain.hashBlock(previousBlockHash, currentBlockData, nonce);
	const newBlock = dynachain.createNewBlock(nonce, previousBlockHash, blockHash);

	const requestPromises = [];
	dynachain.networkNodes.forEach(networkNodeUrl => {
		const requestOptions = {
			uri: networkNodeUrl + '/receive-new-block',
			method: 'POST',
			body: { newBlock: newBlock },
			json: true
		};

		requestPromises.push(rp(requestOptions));
	});
	Promise.all(requestPromises)
	.then(data => {
		const requestOptions = {
			uri: dynachain.currentNodeUrl + '/transaction/broadcast',
			method: 'POST',
			body: {
				amount: 12.5,
				sender: "00",
				recipient:blockaddress
			},
			json: true
		};

		return rp(requestOptions);
	})
	.then(data => {
		res.json({
			note: "New block mined & broadcast successfully",
			block: newBlock
		});
	});
});


// receive new block
app.post('/receive-new-block', function(req, res) {
	const newBlock = req.body.newBlock;
	const lastBlock = dynachain.getLastBlock();
	const correctHash = lastBlock.hash === newBlock.previousBlockHash; 
	const correctIndex = lastBlock['index'] + 1 === newBlock['index'];

	if (correctHash && correctIndex) {
		dynachain.chain.push(newBlock);
		dynachain.pendingTransactions = [];
		res.json({
			note: 'New block received and accepted.',
			newBlock: newBlock
		});
	} else {
		res.json({
			note: 'New block rejected.',
			newBlock: newBlock
		});
	}
});

app.post('/register-and-broadcast-node', function(req, res) {
	const newNodeUrl = req.body.newNodeUrl;
	if (dynachain.networkNodes.indexOf(newNodeUrl) == -1) dynachain.networkNodes.push(newNodeUrl);

	const regNodesPromises = [];
	dynachain.networkNodes.forEach(networknodeurl => {
		const requestOptions = {
			uri: networknodeurl + '/register-node',
			method: 'POST',
			body: { newNodeUrl: newNodeUrl },
			json: true
		};

		regNodesPromises.push(rp(requestOptions));
	});

	Promise.all(regNodesPromises)
	.then(data => {
		const bulkRegisterOptions = {
			uri: newNodeUrl + '/register-nodes-bulk',
			method: 'POST',
			body: { allNetworkNodes: [ ...dynachain.networkNodes, dynachain.currentNodeUrl ] },
			json: true
		};

		return rp(bulkRegisterOptions);
	})
	.then(data => {
		res.json({ note: 'New node registered with network successfully.' });
	});
});


// register a node with the network
app.post('/register-node', function(req, res) {
	const newNodeUrl = req.body.newNodeUrl;
	const nodeNotAlreadyPresent = dynachain.networkNodes.indexOf(newNodeUrl) == -1;
	const notCurrentNode = dynachain.currentNodeUrl !== newNodeUrl;
	if (nodeNotAlreadyPresent && notCurrentNode) dynachain.networkNodes.push(newNodeUrl);
	res.json({ note: 'New node registered successfully.' });
});


// register multiple nodes at once
app.post('/register-nodes-bulk', function(req, res) {
	const allNetworkNodes = req.body.allNetworkNodes;
	allNetworkNodes.forEach(networkNodeUrl => {
		const nodeNotAlreadyPresent = dynachain.networkNodes.indexOf(networkNodeUrl) == -1;
		const notCurrentNode = dynachain.currentNodeUrl !== networkNodeUrl;
		if (nodeNotAlreadyPresent && notCurrentNode) dynachain.networkNodes.push(networkNodeUrl);
	});

	res.json({ note: 'Bulk registration successful.' });
});
app.get('/block/:blockHash',function(req,res){
    const blockHash=req.params.blockHash;
    const correctBlock=dynachain.getBlock(blockHash);
    res.json({block:correctBlock});
});

app.get('/transaction/:transactionId',function(req,res){
    const transactionId=req.params.transactionId;
    const transactionData=dynachain.getTransaction(transactionId);
    res.json({transaction:transactionData.transaction,
    block:transactionData});
});

app.get("/address/:address",function(req,res){
   const address=req.params.address;
   const addressData=dynachain.getAddressData(address);
   res.json({
       addressData:addressData
   })
});
app.get('/block-explorer',function(req,res){
    res.sendFile('./Block-explorer/index.html',{root:__dirname});
})

app.listen(port,function(){
    console.log('listening on port '+port);
})