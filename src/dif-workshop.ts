import { LinkedCredential, LinkedFile, TruvityClient, VcNotEmptyClaim, VcSchema } from '@truvity/sdk';
import { log, logSchemaPublication, logSection } from './utils.js';

// ============================================================================
//  Truvity SDK Demo — Airline Ticket Purchase
// ============================================================================
//
//  This demo walks through a realistic decentralized credential exchange
//  between two independent parties:
//
//    • Tim (a traveler)        — wants to book a flight
//    • SkyTrust Airlines       — sells and issues tickets
//
//  Neither party shares a database. Instead, they exchange tamper-proof
//  Verifiable Credentials (VCs) over a trust infrastructure powered by
//  the Truvity SDK. The flow is:
//
//    1. The airline publishes credential schemas (the "forms" it accepts).
//    2. Tim discovers those schemas and submits a purchase request.
//    3. The airline finds unprocessed requests, applies business logic,
//       issues a ticket, and sends everything back.
//    4. Tim receives the response, follows the credential links, and
//       downloads his boarding pass.
//
//  Along the way the demo highlights: schema publication, credential
//  issuance and signing, credential search & filtering, linked
//  credentials, file attachments, and verifiable presentations.
//
// ============================================================================

// ────────────────────────────────────────────────────────────────────────────
//  Step 1 — Define credential schemas
// ────────────────────────────────────────────────────────────────────────────
//  Schemas are the shared language between parties. They describe the shape
//  of each credential type — think of them as strongly-typed forms that both
//  the issuer and the holder agree on.

/** A traveler's request to purchase a flight ticket. */
@VcSchema({ slug: 'purchase-request', version: 1 })
class AirlinePurchaseRequest {
    @VcNotEmptyClaim
    firstName!: string;

    @VcNotEmptyClaim
    lastName!: string;

    @VcNotEmptyClaim
    from!: string;

    @VcNotEmptyClaim
    to!: string;
}

/** The issued airline ticket, including a printable boarding pass. */
@VcSchema({ slug: 'purchased-ticket', version: 1 })
class AirlinePurchasedTicket {
    @VcNotEmptyClaim
    flightNumber!: string;

    @VcNotEmptyClaim
    seatNumber!: string;

    @VcNotEmptyClaim
    paperVersion!: LinkedFile;
}

/** The airline's response: links the original request, the issued ticket, and the price. */
@VcSchema({ slug: 'purchase-response', version: 1 })
class AirlinePurchaseResponse {
    @VcNotEmptyClaim
    request!: LinkedCredential<AirlinePurchaseRequest>;

    @VcNotEmptyClaim
    ticket!: LinkedCredential<AirlinePurchasedTicket>;

    @VcNotEmptyClaim
    price!: number;
}

// ────────────────────────────────────────────────────────────────────────────
//  Step 2 — Initialize API clients for both parties
// ────────────────────────────────────────────────────────────────────────────
//  Each party authenticates with its own API key. In production these would
//  run in entirely separate systems; here we just use two client instances.

logSection('Initializing API Clients');

const timClient = new TruvityClient({
    apiKey: process.env.TIM_API_KEY,
    environment: 'https://api.truvity.cloud',
});

const airlineClient = new TruvityClient({
    apiKey: process.env.AIRLINE_API_KEY,
    environment: 'https://api.truvity.cloud',
});

log('Tim client ready.');
log('SkyTrust Airlines client ready.');

// ────────────────────────────────────────────────────────────────────────────
//  Step 3 — Airline publishes its credential schemas
// ────────────────────────────────────────────────────────────────────────────
//  Publishing makes the schemas discoverable. Other parties can then issue
//  credentials that conform to these definitions — like posting an API spec
//  that clients can code against.

logSection('Airline Publishes Schemas');

const airlinePurchaseRequest = airlineClient.createVcDecorator(AirlinePurchaseRequest);
logSchemaPublication(AirlinePurchaseRequest.name, await airlinePurchaseRequest.publishSchema());

const airlinePurchasedTicket = airlineClient.createVcDecorator(AirlinePurchasedTicket);
logSchemaPublication(AirlinePurchasedTicket.name, await airlinePurchasedTicket.publishSchema());

const airlinePurchaseResponse = airlineClient.createVcDecorator(AirlinePurchaseResponse);
logSchemaPublication(AirlinePurchaseResponse.name, await airlinePurchaseResponse.publishSchema());

// ────────────────────────────────────────────────────────────────────────────
//  Step 4 — Tim discovers and binds to the airline's schemas
// ────────────────────────────────────────────────────────────────────────────
//  In a real application Tim would discover the airline's schemas through a
//  catalog or documentation site. Binding to the airline's workspace ID tells
//  the SDK: "I want to use the Purchase Request schema *as defined by this
//  specific airline*." This ensures both parties agree on the data format.

logSection('Tim Discovers Airline Schemas');

// Retrieve the airline's workspace identifier (the schema owner).
// In production this would come from the schema catalog.
const airlineSchemaWorkspaceId = await airlineClient.tenantId();

@VcSchema({ slug: 'purchase-request', version: 1, owner: airlineSchemaWorkspaceId })
class PurchaseRequestFromAirline extends AirlinePurchaseRequest {}

@VcSchema({ slug: 'purchased-ticket', version: 1, owner: airlineSchemaWorkspaceId })
class PurchasedTicketFromAirline extends AirlinePurchasedTicket {}

@VcSchema({ slug: 'purchase-response', version: 1, owner: airlineSchemaWorkspaceId })
class PurchaseResponseFromAirline extends AirlinePurchaseResponse {}

// Resolve the airline's DID — its decentralized address for receiving credentials.
const { id: airlineDid } = await airlineClient.dids.didDocumentSelfGet();

log('Airline DID resolved: %s', airlineDid);
log('Tim is now ready to interact with SkyTrust Airlines.');

// ────────────────────────────────────────────────────────────────────────────
//  Step 5 — Tim submits a ticket purchase request
// ────────────────────────────────────────────────────────────────────────────
//  Tim fills out a purchase request credential and sends it to the airline.
//  The credential is signed with Tim's private key, cryptographically proving
//  that the request genuinely came from him.

logSection('Tim Submits Purchase Request');

{
    const timPurchaseRequest = timClient.createVcDecorator(PurchaseRequestFromAirline);

    // Generate a fresh Ed25519 key pair for Tim to sign his credentials.
    const timKey = await timClient.keys.keyGenerate({
        data: {
            type: 'ED25519',
        },
    });

    const purchaseRequestVc = await timPurchaseRequest.issue(timKey.id, {
        claims: {
            firstName: 'Tim',
            lastName: 'Doe',
            from: 'Berlin (BER)',
            to: 'New York (JFK)',
        },
    });

    log('Tim issued a purchase request: Berlin → New York.');

    // Send the signed credential directly to the airline.
    await purchaseRequestVc.send(airlineDid, timKey.id);

    log('Purchase request sent to SkyTrust Airlines.');
}

// ────────────────────────────────────────────────────────────────────────────
//  Step 6 — Airline processes incoming purchase requests
// ────────────────────────────────────────────────────────────────────────────
//  The airline searches its credential store for unprocessed requests, runs
//  business logic (pricing, seat assignment), creates a ticket, attaches a
//  printable boarding pass, and sends the full response back — all as
//  cryptographically linked Verifiable Credentials.

logSection('Airline Processes Purchase Requests');

{
    // Generate a signing key for the airline.
    const airlineKey = await airlineClient.keys.keyGenerate({
        data: {
            type: 'ED25519',
        },
    });

    // Search for purchase requests that haven't been processed yet.
    // We use the `processedAt` label as a lightweight state flag: if it's
    // null, the request is still waiting in the queue.
    const unprocessedPurchaseRequests = await airlineClient.credentials.credentialSearch({
        filter: [
            {
                data: {
                    type: {
                        operator: 'IN',
                        values: [await airlinePurchaseRequest.getCredentialTerm()],
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

    const total = unprocessedPurchaseRequests.items.length;
    log('Found %s unprocessed purchase request(s).', total);

    for (let i = 0; i < total; i++) {
        const item = unprocessedPurchaseRequests.items[i];
        const num = i + 1;

        log('\n[%s/%s] Processing request %s …', num, total, item.id);

        // Map the raw API resource to a typed decorator for convenient field access.
        const purchaseRequestVc = await airlinePurchaseRequest.map(item);
        const { firstName, lastName, from, to } = await purchaseRequestVc.getClaims();

        log('  Passenger : %s %s', firstName, lastName);
        log('  Route     : %s → %s', from, to);

        // ── Business logic ──────────────────────────────────────────────
        let price = 350;
        if (firstName === 'Tim') {
            price += 50; // Loyal-customer surcharge — sorry Tim!
        }

        const seatNumber = `${12 + i}A`;
        const flightNumber = 'ST-4217';

        log('  Flight    : %s', flightNumber);
        log('  Seat      : %s', seatNumber);
        log('  Price     : $%s', price);

        // ── Create the ticket credential ────────────────────────────────
        const ticketDraft = await airlinePurchasedTicket.create({
            claims: {
                flightNumber,
                seatNumber,
            },
        });

        // Generate a human-readable boarding pass and attach it to the ticket.
        const p = (s: string) => s.padEnd(41);
        const boardingPassText = `
        ╔═══════════════════════════════════════════╗
        ║         SKYTRUST AIRLINES                 ║
        ╠═══════════════════════════════════════════╣
        ║ ${p(`Passenger : ${firstName} ${lastName}`)} ║
        ║ ${p(`Flight    : ${flightNumber}`)} ║
        ║ ${p(`Route     : ${from} → ${to}`)} ║
        ║ ${p(`Seat      : ${seatNumber}`)} ║
        ║ ${p(`Price     : $${price}`)} ║
        ╚═══════════════════════════════════════════╝
        `;

        const boardingPassFile = await airlineClient.createLinkedFile(Buffer.from(boardingPassText, 'utf8'), {
            filename: 'boarding-pass.txt',
        });

        // Attach the boarding pass and issue the ticket as a signed VC.
        const updatedTicketDraft = await ticketDraft.update({
            claims: {
                paperVersion: boardingPassFile,
            },
        });

        const ticketVc = await updatedTicketDraft.issue(airlineKey.id);

        // ── Create the purchase response ────────────────────────────────
        // The response links three things together:
        //   1. The original purchase request (provenance)
        //   2. The newly issued ticket (the deliverable)
        //   3. The price (business metadata)
        const responseVc = await airlinePurchaseResponse.issue(airlineKey.id, {
            claims: {
                request: purchaseRequestVc,
                ticket: ticketVc,
                price,
            },
        });

        // ── Send everything back to the requester ───────────────────────
        // Bundle the ticket and response into a Verifiable Presentation
        // and send it to the DID that issued the original request.
        const { issuer: requesterDid } = await purchaseRequestVc.getMetaData();

        const presentation = await airlineClient.createVpDecorator().issue([ticketVc, responseVc], airlineKey.id);
        await presentation.send(requesterDid, airlineKey.id);

        // Mark this request as processed so it won't appear in future searches.
        await purchaseRequestVc.update({
            labels: {
                processedAt: Date.now().toString(),
            },
        });

        log('  Response sent back to requester.');
    }
}

// ────────────────────────────────────────────────────────────────────────────
//  Step 7 — Tim receives and verifies his ticket
// ────────────────────────────────────────────────────────────────────────────
//  Tim's client searches for purchase responses from the airline, then
//  follows the linked credentials to retrieve his ticket and download the
//  attached boarding pass. This demonstrates the full trust chain: Tim can
//  verify that every credential in the chain was signed by the airline and
//  that nothing has been tampered with.

logSection('Tim Receives His Ticket');

{
    const timPurchaseResponse = timClient.createVcDecorator(PurchaseResponseFromAirline);

    // Find the most recent purchase response.
    const result = await timClient.credentials.credentialSearch({
        sort: [
            {
                field: 'DATA_VALID_FROM',
                order: 'DESC',
            },
        ],
        filter: [
            {
                data: {
                    type: {
                        operator: 'IN',
                        values: [await timPurchaseResponse.getCredentialTerm()],
                    },
                },
            },
        ],
    });

    // Map the first (most recent) result to a typed decorator.
    const purchaseResponseVc = await timPurchaseResponse.map(result.items[0]);
    const responseClaims = await purchaseResponseVc.getClaims();

    log('Received purchase response — total price: $%s', responseClaims.price);

    // Follow the credential link to retrieve the ticket VC.
    const purchasedTicketVc = await responseClaims.ticket.dereferenceVerifiableCredentialAs(PurchasedTicketFromAirline);
    const ticketClaims = await purchasedTicketVc.getClaims();

    log('Ticket verified — Flight: %s, Seat: %s', ticketClaims.flightNumber, ticketClaims.seatNumber);

    // Download the attached boarding pass document.
    const ticketPaperVersion = await ticketClaims.paperVersion.dereference();
    const ticketPaperBlob = await ticketPaperVersion.download();
    const boardingPass = await ticketPaperBlob.text();

    log('\nBoarding pass:\n\n%s\n', boardingPass);
    log('Demo complete — Tim has a cryptographically verified ticket from Berlin to New York!');
}
