import {
    TruvityClient,
    LinkedCredential,
    VcContext,
    VcLinkedCredentialClaim,
    VcNotEmptyClaim,
    VcLinkedFileClaim,
    LinkedFile,
} from '@truvity/sdk';

// --- Documents schemas ---

@VcContext({
    name: 'TicketPurchaseRequest',
    namespace: 'urn:dif:hackathon/vocab/airline',
})
class PurchaseRequest {
    @VcNotEmptyClaim
    firstName!: string;

    @VcNotEmptyClaim
    lastName!: string;
}

@VcContext({
    name: 'Ticket',
    namespace: 'urn:dif:hackathon/vocab/airline',
})
class PurchasedTicked {
    @VcNotEmptyClaim
    flightNumber!: string;

    @VcNotEmptyClaim
    @VcLinkedFileClaim
    paperVersion!: LinkedFile;
}

@VcContext({
    name: 'TicketPurchaseResponse',
    namespace: 'urn:dif:hackathon/vocab/airline',
})
class PurchaseResponse {
    @VcNotEmptyClaim
    @VcLinkedCredentialClaim
    request!: LinkedCredential<PurchaseRequest>;

    @VcNotEmptyClaim
    @VcLinkedCredentialClaim
    ticket!: LinkedCredential<PurchasedTicked>;

    @VcNotEmptyClaim
    price!: number;
}

// Initialize API clients and create cryptographic key pairs

const timClient = new TruvityClient({
    apiKey: process.env.TIM_API_KEY,
    environment: 'https://api.truvity.cloud',
});

const airlineClient = new TruvityClient({
    apiKey: process.env.AIRLINE_API_KEY,
    environment: 'https://api.truvity.cloud',
});

// Retrieving a well-known DID of the Airline from its DID Document
const { id: airlineDid } = await airlineClient.dids.didDocumentSelfGet();

// --- Tim initiate purchase ---
{
    const purchaseRequest = timClient.createVcDecorator(PurchaseRequest);

    // Generating a new cryptographic key pair for Tim
    const timKey = await timClient.keys.keyGenerate({
        data: {
            type: 'ED25519',
        },
    });

    const purchaseRequestVc = await purchaseRequest.issue(timKey.id, {
        claims: {
            firstName: 'Tim',
            lastName: 'Dif',
        },
    });

    await purchaseRequestVc.send(airlineDid, timKey.id);
}

// --- Airline handles request ---

{
    // Instantiating document APIs
    const purchaseRequest = airlineClient.createVcDecorator(PurchaseRequest);
    const purchasedTicked = airlineClient.createVcDecorator(PurchasedTicked);
    const purchaseResponse = airlineClient.createVcDecorator(PurchaseResponse);

    // Generating a new cryptographic key pair for the Airline
    const airlineKey = await airlineClient.keys.keyGenerate({
        data: {
            type: 'ED25519',
        },
    });

    // Searching for unprocessed tickets purchase request VCs
    const unprocessedPurchaseRequests = await airlineClient.credentials.credentialSearch({
        filter: [
            {
                data: {
                    type: {
                        operator: 'IN',
                        values: [purchaseRequest.getCredentialTerm()],
                    },
                },
                labels: [
                    {
                        operator: 'IS_NULL',
                        key: 'processedAt',
                    },
                ],
            },
        ],
    });

    const unprocessedRequestsCount = unprocessedPurchaseRequests.items.length;

    console.info(`Unprocessed purchase requests count: ${unprocessedRequestsCount}`);

    // Processing new requests
    for (let i = 0; i < unprocessedRequestsCount; i++) {
        const item = unprocessedPurchaseRequests.items[i];
        const itemNumber = i + 1;

        console.info(`Starting processing purchase request: ${item.id} (${itemNumber}/${unprocessedRequestsCount})`);

        // Converting API resource to UDT to enable additional API for working with the content of the VC
        const purchaseRequestVc = purchaseRequest.map(item);

        let price = 100;

        const { firstName } = await purchaseRequestVc.getClaims();

        // Performing some custom business logic based on the VC content
        if (firstName === 'Tim') {
            price += 20; // Unlucky Tim...
        }

        const ticketDraft = await purchasedTicked.create({
            claims: {
                flightNumber: '123',
            },
        });

        // We can always access previously filled-in claims
        const ticketClaims = await ticketDraft.getClaims();

        // Rendering a "PDF" with the ticket information. For the sake of the demo, we're going to use the `txt` format
        const ticketPaperDocument = Buffer.from(`Your flight number: ${ticketClaims.flightNumber}`, 'utf8');

        // Uploading the created "PDF" to the API
        const ticketPaperVersion = await airlineClient.createLinkedFile(ticketPaperDocument, {
            filename: 'ticket.txt',
        });

        const updatedTicketDraft = await ticketDraft.update({
            claims: {
                paperVersion: ticketPaperVersion, // linking uploaded "PDF"
            },
        });

        const ticketVc = await updatedTicketDraft.issue(airlineKey.id);

        const responseVc = await purchaseResponse.issue(airlineKey.id, {
            claims: {
                request: purchaseRequestVc, // linking original request
                ticket: ticketVc, // linking newly issued ticket
                price, // providing additional information about the transaction
            },
        });

        // Retrieving information about the issuer of the request. We'll use to send the response back
        const { issuer: requesterDid } = await purchaseRequestVc.getMetaData();

        // const presentation = await airlineClient.createVpDecorator().issue([ticketVc, responseVc], airlineKey.id);
        // await presentation.send(requesterDid, airlineKey.id);

        await airlineClient.didcommMessages.didCommMessageSend({
            data: {
                to: requesterDid,
                keyId: airlineKey.id,
                credentials: [ticketVc.descriptor.id, responseVc.descriptor.id],
                files: [(await ticketPaperVersion.dereference()).id],
            },
        });

        // Mark the processed purchase request as handled
        await purchaseRequestVc.update({
            labels: {
                processedAt: Date.now().toString(),
            },
        });

        console.info(
            `Purchase request has been successfully processed: ${item.id} (${itemNumber}/${unprocessedRequestsCount})`,
        );
    }
}

// Tim handles the received request

{
    const purchaseResponse = timClient.createVcDecorator(PurchaseResponse);

    const result = await timClient.credentials.credentialSearch({
        sort: [
            {
                field: 'DATA_VALID_FROM', // applying sort by date so that the newest ticket will be first
                order: 'DESC',
            },
        ],
        filter: [
            {
                data: {
                    type: {
                        operator: 'IN',
                        values: [purchaseResponse.getCredentialTerm()],
                    },
                },
            },
        ],
    });

    // Converting the first API resource from the search result to UDT to enable additional API for working with the content of the VC
    const purchaseResponseVc = purchaseResponse.map(result.items[0]);

    const responseClaims = await purchaseResponseVc.getClaims();

    // Dereferencing the link to a credential to enable working with its content
    const purchasedTicketVc = await responseClaims.ticket.dereferenceAs(PurchasedTicked);

    const ticketClaims = await purchasedTicketVc.getClaims();
    const ticketPaperVersion = await ticketClaims.paperVersion.dereference();
    const ticketPaperDocument = await ticketPaperVersion.download();

    // Completing the demo
    console.info(`Last ticket: "${ticketPaperDocument.toString('utf8')}" (price: $${responseClaims.price})`);
}
