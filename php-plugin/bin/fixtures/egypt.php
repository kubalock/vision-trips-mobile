<?php
/**
 * Demo booking: "Cairo, Alexandria & the Nile" with Newells Travel (Falmouth).
 * Returns ['graph' => Airtable-shaped graph, 'mocks' => integration mocks] for a journey stage.
 * Dates are relative to today so every stage renders correctly whenever the preview is built.
 */
declare(strict_types=1);

return static function (string $stage, callable $img): array {
    $today = new DateTimeImmutable('today', new DateTimeZone('Europe/London'));
    $offset = match ($stage) {
        'quote' => 170, 'countdown' => 118, 'prep' => 6, 'departure' => 0, 'travelling' => -3, 'home' => -14, default => 118,
    };
    $d = static fn (int $days) => $today->modify(($days + $offset >= 0 ? '+' : '') . ($days + $offset) . ' days')->format('Y-m-d');
    $status = $stage === 'quote' ? 'Quotation' : 'Confirmed';
    $paid = $stage === 'quote' ? 0 : ($offset > 80 ? 1200.00 : 7335.00);
    $balance = 7335.00 - $paid;

    $booking = ['id' => 'recB00K1NG000001A', 'fields' => [
        'Booking Reference' => '"NWG-72565"',
        'Trip Name' => 'Cairo, Alexandria & the Nile',
        'Status' => $status,
        'Tags' => ['Affordable Luxury', 'River Cruise', 'Long Haul'],
        'Holiday Type(s)' => ['Luxury', 'River Cruising'],
        'Traveller Type' => 'Couple',
        'Sector' => 'Luxury',
        'Departure Date' => [$d(0)],
        'Return Date' => [$d(11)],
        'Trip Duration' => 11,
        'Countries' => ['Egypt'],
        'Destinations' => ['recL0C000000CAIRO', 'recL0C000000LUXOR'],
        'Hero Image' => [['url' => $img('egypt-hero.jpg'), 'type' => 'image/jpeg', 'filename' => 'nile.jpg', 'width' => 1400, 'height' => 900]],
        'Total Price' => 7335.00,
        'MS Paid' => $paid,
        'MS Outstanding ' => $balance,
        'Next Customer Payment Amount' => [$balance > 0 ? ($stage === 'quote' ? 1200.00 : $balance) : 0],
        'Next Customer Payment Due Date' => [$stage === 'quote' ? $today->format('Y-m-d') : $d(-70)],
        'balanceDueDate' => [$d(-70)],
        'Customers' => ['recCUST000000001A'],
        'Customers [People]' => ['recPE0PLE0000001A', 'recPE0PLE0000002A'],
        'Bookings [Elements]' => ['recELEM000000001A', 'recELEM000000002A', 'recELEM000000003A', 'recELEM000000004A', 'recELEM000000005A', 'recELEM000000006A', 'recELEM000000007A'],
        'Bookings [Payments]' => ['recPAY0000000001A', 'recPAY0000000002A', 'recPAY0000000003A'],
        'Upsells' => ['recUPS0000000001A', 'recUPS0000000002A'],
        'Brands & Branches' => ['recBRAND00000001A'],
        'Members' => ['recMEMBER0000001A'],
        'Member | Proposition' => ['Worldchoice Plus'],
        'Members | Company Name' => ['Newells Travel Ltd'],
        'Members | Number' => ['Q9043'],
        'Personalised Message' => "It was lovely to chat through Egypt with you both. I've built this around the Nile cruise you fell for, with two nights at Mena House first so you wake up looking at the pyramids. The private Egyptologist in Cairo is included; the balloon ride is optional but, honestly, worth every penny.\n\nAny questions at all, I'm on the other end of the phone.",
        'Include Personalised Message' => true,
        'SinGS Agent Name' => 'Sarah Penrose',
        'Created time' => $today->modify('-21 days')->format(DATE_ATOM),
        'Quotation Expiry' => $today->modify('+9 days')->format('Y-m-d'),
        'ATOL' => 'Single-Contract Package',
        'Licensing' => "Sales of other ATOL holders' packages (Single-Contract)",
        'ATOL No.' => ['2990'],
        'leadSupplier' => ['recSUPP000000002A'],
        'Total Passengers & Guests' => 2,
        'Customers | Email' => ['e.trevithick@example.com'],
        'Customers | Phone' => ['07700 900123'],
        'Customers | Postcode' => ['TR11 3AB'],
        'Customer | Emergency Telephone' => ['07700 900456'],
        'Currency' => ['GBP'],
        'Supplier Tickets Received' => $offset <= 6,
        'Customer Communication' => ['recC0MM000000001A', 'recC0MM000000002A', 'recC0MM000000003A'],
        'Booking Confirmation' => $stage !== 'quote',
        'Booking Reconfirmed' => $offset <= 40,
        'Travel Documents' => $offset <= 6,
        'Pre-Departure Call' => $offset <= 1,
        'Post-Travel Follow-Up' => false,
    ]];

    $brand = ['id' => 'recBRAND00000001A', 'fields' => [
        'Trading Name' => 'Newells Travel',
        'Company Name' => ['Newells Travel Ltd'],
        'Proposition' => ['Worldchoice Plus'],
        'Primary Colour' => '#0E6D74',
        'Secondary Colour' => '#E8B44C',
        'Slogan' => 'Falmouth\'s independent travel specialists since 1991',
        'Member Tone' => 'Formal (Luxury Focus)',
        'Logo' => [['url' => $img('newells-logo.svg'), 'type' => 'image/svg+xml', 'filename' => 'logo.svg']],
        'Transparent Logo' => [['url' => $img('newells-logo.svg'), 'type' => 'image/svg+xml', 'filename' => 'logo.svg']],
        'Hero Image' => [['url' => $img('falmouth.jpg'), 'type' => 'image/jpeg', 'filename' => 'falmouth.jpg']],
        'Customer | Telephone' => '01326 312 345',
        'Customer | Email Address' => 'hello@newellstravel.co.uk',
        'Customer | Website' => 'www.newellstravel.co.uk',
        'Customer | Emergency Telephone' => '07700 900456',
        'Physical Address' => true,
        'Shop | Address Line 1' => '12 Church Street',
        'Shop | Town/City' => 'Falmouth',
        'Shop | Post Code' => 'TR11 3DR',
        'Shop | Country' => 'United Kingdom',
        'Opening Hours' => "Monday to Friday 9am – 5.30pm\nSaturday 9.30am – 4pm",
        'About & Bio' => 'We are a family-run agency on Falmouth\'s high street. Everything we recommend, we have either been to or quizzed a colleague who has.',
        'Social Media: Instagram' => '@newellstravel',
        'Social Media: Facebook' => 'https://facebook.com/newellstravel',
        'Google Reviews URL' => 'https://g.page/r/newells-travel/review',
        'Display Logos' => ['ATOL', 'Worldchoice Plus', 'ABTA'],
        'Trust Account | Account Name' => 'Newells Travel Ltd Client Trust',
        'Trust Account | Sort Code' => '30-93-57',
        'Trust Account | Account Number' => '12345678',
        'Template | Correct Names Notice' => 'Please check that all names match passports exactly, including middle names. Airlines charge for corrections after ticketing and some will not permit changes at all.',
        'Template | Total Price Information' => 'The total price shown includes all taxes and charges known at the time of booking. Any amounts marked as payable locally are collected by the supplier in resort and are shown in sterling as a guide only.',
        'Template | Financial Protection Information' => 'When you buy an ATOL-protected flight-inclusive package from us you will receive an ATOL Certificate listing what is financially protected, where you can get information on what this means for you and who to contact if things go wrong. Money paid for non-flight arrangements is held in our independent trust account until it is paid to your suppliers.',
        'Template | Terms & Conditions' => "Your contract is with the package organiser named on your confirmation. Deposits are non-refundable. Balances are due 12 weeks before departure; if the balance is not received by the due date we reserve the right to treat the booking as cancelled.\n\nCancellation charges apply as set out in the organiser's conditions, which we will provide on request and which form part of this contract.",
        'Template | Flight Information' => 'Flight times are provisional until tickets are issued and may change. Please reconfirm times 24 hours before departure. Check-in opens 3 hours before long-haul departures.',
        'Template | Travel Insurance' => 'We strongly recommend you take out comprehensive travel insurance at the time of booking, covering cancellation, medical expenses and repatriation.',
        'Template | Travel Aware' => 'Stay safe and healthy abroad: check the FCDO travel advice and TravelHealthPro for your destination before you travel and while you are away.',
        'Template | Important Information' => 'Passports must be valid for at least six months from your date of entry to Egypt. A tourist visa is required for UK passport holders and can be bought online in advance. Please tell us about any special assistance requirements as early as possible.',
        'Mint | Allow Custom Payments' => true,
        'Mint | Custom Payment Methods' => ['CARD', 'PAYBYBANK'],
        'Mint | API Key' => 'demo',
        'Mint | Business Unit' => 'demo',
    ]];

    $member = ['id' => 'recMEMBER0000001A', 'fields' => [
        'Company Name' => 'Newells Travel Ltd', 'Member Number' => 'Q9043', 'Company Registration Number' => '02654321', 'VAT Registered' => true, 'VAT Registration Number' => 'GB 574 2211 09',
        'Registered Office | Address Line 1' => '12 Church Street', 'Registered Office | Town/City' => 'Falmouth', 'Registered Office | Post Code' => 'TR11 3DR', 'Registered Office (Country)' => 'United Kingdom',
        'Proposition' => 'Worldchoice Plus', 'T-ATOL Enabled' => false,
    ]];

    $customers = [['id' => 'recCUST000000001A', 'fields' => ['Full Name' => 'Mrs Eleanor Trevithick', 'First Name' => 'Eleanor', 'Last Name' => 'Trevithick', 'Primary Email' => 'e.trevithick@example.com', 'Primary Telephone' => '07700 900123', 'Address Line 1' => '4 Trelawney Road', 'Address Town/City' => 'Falmouth', 'Address Post Code' => 'TR11 3AB', 'Address Country' => 'United Kingdom']]];
    $people = [
        ['id' => 'recPE0PLE0000001A', 'fields' => ['Full Name' => 'Eleanor Trevithick', 'First Name' => 'Eleanor', 'Last Name' => 'Trevithick', 'Date of Birth' => '1968-04-12', 'Age' => 58, 'Expiry Date' => $today->modify('+4 months')->format('Y-m-d'), 'Meal Request' => ['VGML = Vegan Meal']]],
        ['id' => 'recPE0PLE0000002A', 'fields' => ['Full Name' => 'James Trevithick', 'First Name' => 'James', 'Last Name' => 'Trevithick', 'Date of Birth' => '1966-09-30', 'Age' => 60, 'Expiry Date' => $today->modify('+5 years')->format('Y-m-d')]],
    ];

    $elements = [
        ['id' => 'recELEM000000001A', 'fields' => ['Type' => 'Flight', 'Status' => 'Confirmed', 'Pick Up Date' => $d(0), 'Return Date' => $d(0), 'Depart Time' => '10:40', 'Arrival Time' => '17:05', 'Carrier' => ['recAIRL000000001A'], 'Flight No.' => 'BA155', 'Flight Class' => 'Club World', 'Dep. Airport Name' => ['recAPRT000000LHR0'], 'Arr. Airport Name' => ['recAPRT000000CAI0'], 'Direction' => 'Outbound', 'Supplier' => ['recSUPP000000001A'], 'Supplier Reference' => 'QX7J2L', 'Passengers & Guests' => ['recPASS000000001A', 'recPASS000000002A'], 'Package' => true, 'Gross' => 2180.00, 'Net' => 1990.00]],
        ['id' => 'recELEM000000002A', 'fields' => ['Type' => 'Transfer', 'Status' => 'Confirmed', 'Pick Up Date' => $d(0), 'Depart Time' => '17:45', 'Pick Up Location' => 'Cairo International Airport, Terminal 3', 'Drop Off Location' => 'Marriott Mena House, Giza', 'Vehicle Type' => 'Private air-conditioned saloon', 'Pick Up Instructions' => 'Your driver will be waiting in the arrivals hall holding a board with your name. If you cannot find them, call the emergency number below before leaving the airport.', 'Emergency Supplier Name' => 'Travco Cairo', 'Emergency Phone Number(s)' => '+20 2 2735 2611', 'Supplier' => ['recSUPP000000002A'], 'Supplier Reference' => 'TRV-88213', 'Package' => true]],
        ['id' => 'recELEM000000003A', 'fields' => ['Type' => 'Accommodation', 'Status' => 'Confirmed', 'Pick Up Date' => $d(0), 'Return Date' => $d(2), 'Trip Element Heading' => 'Marriott Mena House, Cairo', 'Address' => '6 Pyramids Road, Giza, Cairo', 'Rating' => ['5'], 'Rooms' => ['recROOM000000001A'], 'Location' => ['recL0C000000CAIRO'], 'Supplier' => ['recSUPP000000002A'], 'Supplier Reference' => 'MH-449021', 'Package' => true, 'Image Gallery' => [['url' => $img('mena-house.jpg'), 'type' => 'image/jpeg', 'filename' => 'Mena House garden.jpg', 'thumbnails' => ['large' => ['url' => $img('mena-house.jpg')]]], ['url' => $img('terrace.jpg'), 'type' => 'image/jpeg', 'filename' => 'Terrace.jpg', 'thumbnails' => ['large' => ['url' => $img('terrace.jpg')]]]], 'Further Information' => 'Breakfast is served on the terrace from 6.30am. Your private Egyptologist meets you in the lobby at 8am on day 2 for the Pyramids, Sphinx and the Grand Egyptian Museum.']],
        ['id' => 'recELEM000000004A', 'fields' => ['Type' => 'Flight', 'Status' => 'Confirmed', 'Pick Up Date' => $d(2), 'Return Date' => $d(2), 'Depart Time' => '09:15', 'Arrival Time' => '10:20', 'Carrier' => ['recAIRL000000002A'], 'Flight No.' => 'MS355', 'Flight Class' => 'Economy', 'Dep. Airport Name' => ['recAPRT000000CAI0'], 'Arr. Airport Name' => ['recAPRT000000LXR0'], 'Direction' => 'Internal', 'Supplier' => ['recSUPP000000002A'], 'Supplier Reference' => 'LMN4P9', 'Passengers & Guests' => ['recPASS000000003A', 'recPASS000000004A'], 'Package' => true]],
        ['id' => 'recELEM000000005A', 'fields' => ['Type' => 'Cruise', 'Status' => 'Confirmed', 'Pick Up Date' => $d(2), 'Return Date' => $d(9), 'Cruise Name' => 'Luxor to Aswan on the Oberoi Philae', 'Cruise Line' => ['recOPER000000001A'], 'Cruise Ship' => ['recSHIP000000001A'], 'Voyage Code' => 'OBP-LXR-ASW-7', 'Departure Port' => ['Luxor'], 'Disembark Port' => ['Aswan'], 'Nights' => 7, 'Cabin Details' => ['recCABN000000001A'], 'Visiting Ports' => ['recITIN000000001A', 'recITIN000000002A', 'recITIN000000003A', 'recITIN000000004A', 'recITIN000000005A'], 'Onboard Credit' => 150, 'Onboard Credit Currency' => 'USD', 'Supplier' => ['recSUPP000000003A'], 'Supplier Reference' => 'OBP-20271205-TRE', 'Package' => true, 'Important Information' => 'Dress code in the Oberoi restaurant is smart casual in the evening. Shore excursions start early to avoid the heat; bring a hat, sun cream and comfortable shoes.']],
        ['id' => 'recELEM000000006A', 'fields' => ['Type' => 'Flight', 'Status' => 'Confirmed', 'Pick Up Date' => $d(9), 'Return Date' => $d(9), 'Depart Time' => '14:30', 'Arrival Time' => '15:50', 'Carrier' => ['recAIRL000000002A'], 'Flight No.' => 'MS088', 'Flight Class' => 'Economy', 'Dep. Airport Name' => ['recAPRT000000ASW0'], 'Arr. Airport Name' => ['recAPRT000000CAI0'], 'Direction' => 'Internal', 'Supplier' => ['recSUPP000000002A'], 'Supplier Reference' => 'LMN4P9', 'Package' => true]],
        ['id' => 'recELEM000000007A', 'fields' => ['Type' => 'Flight', 'Status' => 'Confirmed', 'Pick Up Date' => $d(11), 'Return Date' => $d(11), 'Depart Time' => '18:30', 'Arrival Time' => '22:25', 'Carrier' => ['recAIRL000000001A'], 'Flight No.' => 'BA154', 'Flight Class' => 'Club World', 'Dep. Airport Name' => ['recAPRT000000CAI0'], 'Arr. Airport Name' => ['recAPRT000000LHR0'], 'Direction' => 'Inbound', 'Supplier' => ['recSUPP000000001A'], 'Supplier Reference' => 'QX7J2L', 'Passengers & Guests' => ['recPASS000000001A', 'recPASS000000002A'], 'Package' => true]],
    ];
    if ($stage === 'quote') {
        foreach ($elements as &$el) {
            $el['fields']['Status'] = 'Quotation';
            unset($el['fields']['Passengers & Guests']);
        }
        unset($el);
    }

    $payments = [
        ['id' => 'recPAY0000000001A', 'fields' => ['Amount' => 1200.00, 'Payment Type' => 'Customer Payment', 'Customer Payment Type' => 'Deposit Payment', 'Status' => $stage === 'quote' ? 'Outstanding' : 'Complete', 'Date Due' => $today->modify('-20 days')->format('Y-m-d'), 'Payment Complete' => $stage === 'quote' ? null : $today->modify('-20 days')->format('Y-m-d'), 'Payment Link URL' => 'https://hpp.mintpayments.com/demo/deposit', "Show 'Pay Now' on Quotation" => true, 'paymentReference' => 'NWG-72565-D1', 'Payment Method' => ['recMETH000000001A'], 'Traveller/Guest' => ['recPE0PLE0000001A']]],
        ['id' => 'recPAY0000000002A', 'fields' => ['Amount' => 6135.00, 'Payment Type' => 'Customer Payment', 'Customer Payment Type' => 'Balance Payment', 'Status' => $offset > 80 || $stage === 'quote' ? 'Outstanding' : 'Complete', 'Date Due' => $d(-70), 'Payment Complete' => $offset > 80 || $stage === 'quote' ? null : $d(-75), 'Payment Link URL' => 'https://hpp.mintpayments.com/demo/balance', 'paymentReference' => 'NWG-72565-B1', 'Payment Method' => ['recMETH000000002A']]],
        ['id' => 'recPAY0000000003A', 'fields' => ['Amount' => 95.00, 'Payment Type' => 'Resort Payment', 'Status' => 'Outstanding', 'Resort Payment Reason' => 'Luxor & Aswan tourism levy', 'Date Due' => $d(2)]],
    ];

    $upsells = [
        ['id' => 'recUPS0000000001A', 'fields' => ['Name' => 'Sunrise balloon flight over Luxor', 'Further Information' => 'An hour above the Valley of the Kings as the sun comes up, with hotel pick-up at 4.30am and breakfast on landing. From £145 per person.', 'Upsell Featured Image' => [['url' => $img('luxor.jpg'), 'type' => 'image/jpeg', 'filename' => 'luxor.jpg', 'thumbnails' => ['large' => ['url' => $img('luxor.jpg')]]]]]],
        ['id' => 'recUPS0000000002A', 'fields' => ['Name' => 'Heathrow lounge and fast-track security', 'Further Information' => 'Start the holiday at the airport: fast-track security and three hours in the Plaza Premium lounge at Terminal 5. From £52 per person.']],
    ];

    $locations = [
        ['id' => 'recL0C000000CAIRO', 'fields' => ['Name' => 'Cairo & Giza', 'Country' => 'Egypt', 'Latitude' => 29.9792, 'Longitude' => 31.1342, 'Featured Image' => [['url' => $img('mena-house.jpg'), 'type' => 'image/jpeg', 'filename' => 'giza.jpg']], 'Destination Overview' => 'Cairo is loud, generous and endlessly layered: Pharaonic, Coptic, Islamic and modern all at once. Giza, on its western edge, is where the Pyramids rise straight out of the suburbs.', 'Key Attractions/Experiences' => "- The Pyramids of Giza and the Sphinx, ideally at opening time\n- The Grand Egyptian Museum\n- Khan el-Khalili bazaar and a coffee at El Fishawy\n- Coptic Cairo and the Hanging Church", 'Practical Information' => 'Egyptian pounds are easiest from ATMs. Tip small and often. Dress modestly away from the hotel; carry a scarf for mosques.', 'FCDO Travel Advice' => 'Check the latest FCDO advice for Egypt before travel; some areas carry advice against all but essential travel.']],
        ['id' => 'recL0C000000LUXOR', 'fields' => ['Name' => 'Luxor', 'Country' => 'Egypt', 'Latitude' => 25.6872, 'Longitude' => 32.6396, 'Featured Image' => [['url' => $img('luxor.jpg'), 'type' => 'image/jpeg', 'filename' => 'luxor.jpg']], 'Destination Overview' => 'Ancient Thebes: the Valley of the Kings on the west bank, Karnak and Luxor temples on the east, and the Nile in between.', 'Key Attractions/Experiences' => "- Karnak at first light\n- The tomb of Seti I\n- A felucca at sunset"]],
        ['id' => 'recL0C000000ESNA0', 'fields' => ['Name' => 'Esna', 'Country' => 'Egypt']],
        ['id' => 'recL0C000000EDFU0', 'fields' => ['Name' => 'Edfu', 'Country' => 'Egypt']],
        ['id' => 'recL0C000000KOMO0', 'fields' => ['Name' => 'Kom Ombo', 'Country' => 'Egypt']],
        ['id' => 'recL0C000000ASWN0', 'fields' => ['Name' => 'Aswan', 'Country' => 'Egypt']],
    ];

    $w3 = [
        'suppliers' => [
            ['id' => 'recSUPP000000001A', 'fields' => ['Name' => 'British Airways', 'Legal Notices URL' => 'https://www.britishairways.com/en-gb/information/legal/british-airways/general-conditions-of-carriage']],
            ['id' => 'recSUPP000000002A', 'fields' => ['Name' => 'Travco', 'ATOL Number' => '2990']],
            ['id' => 'recSUPP000000003A', 'fields' => ['Name' => 'Oberoi Hotels & Resorts']],
        ],
        'airports' => [
            ['id' => 'recAPRT000000LHR0', 'fields' => ['Name' => 'London Heathrow', 'IATA Code' => 'LHR', 'ISO Country' => 'GB', 'Municipality' => 'London']],
            ['id' => 'recAPRT000000CAI0', 'fields' => ['Name' => 'Cairo International', 'IATA Code' => 'CAI', 'ISO Country' => 'EG', 'Municipality' => 'Cairo']],
            ['id' => 'recAPRT000000LXR0', 'fields' => ['Name' => 'Luxor International', 'IATA Code' => 'LXR', 'ISO Country' => 'EG', 'Municipality' => 'Luxor']],
            ['id' => 'recAPRT000000ASW0', 'fields' => ['Name' => 'Aswan International', 'IATA Code' => 'ASW', 'ISO Country' => 'EG', 'Municipality' => 'Aswan']],
        ],
        'airlines' => [['id' => 'recAIRL000000001A', 'fields' => ['Airline' => 'British Airways', 'iata' => 'BA', 'Logo' => [['url' => $img('ba-logo.svg'), 'type' => 'image/svg+xml', 'filename' => 'ba.svg']]]], ['id' => 'recAIRL000000002A', 'fields' => ['Airline' => 'EgyptAir', 'iata' => 'MS', 'Logo' => [['url' => $img('ms-logo.svg'), 'type' => 'image/svg+xml', 'filename' => 'ms.svg']]]]],
        'rooms' => [['id' => 'recROOM000000001A', 'fields' => ['Room Type' => 'Deluxe Pyramid View Room', 'Board Basis' => 'Bed & Breakfast', 'Room Views' => 'Pyramid view']]],
        'cabins' => [['id' => 'recCABN000000001A', 'fields' => ['Cabin Name' => 'Luxury Cabin', 'Cabin Deck' => 'Upper deck', 'Cabin Number' => '204', 'Bed Type' => 'King', 'Seating' => 'First sitting', 'Table Size' => 'Table for two']]],
        'passengers' => [
            ['id' => 'recPASS000000001A', 'fields' => ['Passenger' => 'Eleanor Trevithick', 'Element Type' => ['Flight'], 'Seat Number' => '14A', 'Cabin Baggage Allowance' => '1 x 23kg + handbag', 'Checked Baggage Allowance' => '2 x 32kg', 'Meal Request' => ['VGML = Vegan Meal']]],
            ['id' => 'recPASS000000002A', 'fields' => ['Passenger' => 'James Trevithick', 'Element Type' => ['Flight'], 'Seat Number' => '14B', 'Cabin Baggage Allowance' => '1 x 23kg + handbag', 'Checked Baggage Allowance' => '2 x 32kg']],
            ['id' => 'recPASS000000003A', 'fields' => ['Passenger' => 'Eleanor Trevithick', 'Element Type' => ['Flight'], 'Seat Number' => '7C']],
            ['id' => 'recPASS000000004A', 'fields' => ['Passenger' => 'James Trevithick', 'Element Type' => ['Flight'], 'Seat Number' => '7D']],
        ],
        'ships' => [['id' => 'recSHIP000000001A', 'fields' => ['Name' => 'Oberoi Philae', 'Widgety Ship ID' => 'oberoi-philae', 'Cover Image' => [['url' => $img('nile-ship.jpg'), 'type' => 'image/jpeg', 'filename' => 'philae.jpg']]]]],
        'itinerary' => [
            ['id' => 'recITIN000000001A', 'fields' => ['Day' => '1', 'Port' => ['recL0C000000LUXOR'], 'Depart' => null]],
            ['id' => 'recITIN000000002A', 'fields' => ['Day' => '2', 'Port' => ['recL0C000000LUXOR']]],
            ['id' => 'recITIN000000003A', 'fields' => ['Day' => '3', 'Port' => ['recL0C000000ESNA0']]],
            ['id' => 'recITIN000000004A', 'fields' => ['Day' => '4', 'Port' => ['recL0C000000EDFU0']]],
            ['id' => 'recITIN000000005A', 'fields' => ['Day' => '5', 'Port' => ['recL0C000000KOMO0']]],
        ],
        'elocations' => $locations,
        'operators' => [['id' => 'recOPER000000001A', 'fields' => ['Name' => 'Oberoi Nile Cruises']]],
        'templates' => [],
        'methods' => [['id' => 'recMETH000000001A', 'fields' => ['Name' => 'Card (Mint)']], ['id' => 'recMETH000000002A', 'fields' => ['Name' => 'Bank transfer']]],
    ];

    $comms = [
        ['id' => 'recC0MM000000001A', 'fields' => ['Name' => '"Quotation (Email)"', 'Type' => ['Email'], 'Subject' => ['Your quotation: Cairo, Alexandria & the Nile'], 'Email Template' => ['Thank you for asking us to put this together. Your quotation is ready to view online, with everything we discussed and a few ideas for making it your own.'], 'Date' => $today->modify('-21 days')->format(DATE_ATOM), 'Sent' => true, 'Status' => 'Success']],
        ['id' => 'recC0MM000000002A', 'fields' => ['Name' => '"Booking Confirmation (Email)"', 'Type' => ['Email'], 'Subject' => ['Your booking confirmation'], 'Email Template' => ["Thank you for choosing us. We're delighted to assist you, and we're pleased to share your booking details.\nAs an independent specialist we take care of every detail so you can simply look forward to the trip."], 'Date' => $today->modify('-19 days')->format(DATE_ATOM), 'Sent' => true, 'Status' => 'Success']],
        ['id' => 'recC0MM000000003A', 'fields' => ['Name' => '"Custom Email (Custom Email)"', 'Type' => ['Custom Email'], 'Custom Subject' => 'Your Egyptologist and balloon flight', 'Custom Content' => "<p>Hello Eleanor,</p><p>Just to confirm <b>Ahmed</b> will meet you in the Mena House lobby at 8am on day two. I've also held two places on the sunrise balloon flight over Luxor for you, no obligation.</p><p>Sarah</p>", 'Date' => $today->modify('-6 days')->format(DATE_ATOM), 'Sent' => true, 'Status' => 'Success']],
    ];
    $graph = [
        'fetched_at' => time(),
        'booking' => $booking,
        'w2' => ['brand' => [$brand], 'member' => [$member], 'customers' => $customers, 'people' => $people, 'elements' => $elements, 'payments' => $payments, 'upsells' => $upsells, 'locations' => array_slice($locations, 0, 2), 'comms' => $stage === 'quote' ? [$comms[0]] : $comms],
        'w3' => $w3,
        'ports' => $locations,
    ];

    $mocks = [
        'places' => [
            'Marriott Mena House, Cairo, 6 Pyramids Road, Giza, Cairo' => [
                'id' => 'ChIJdemoMenaHouse', 'name' => 'Marriott Mena House, Cairo', 'address' => '6 Pyramids Rd, Al Haram, Giza, Egypt', 'rating' => 4.6, 'ratings' => 9814, 'website' => 'https://www.marriott.com/en-us/hotels/caimn-marriott-mena-house-cairo/overview/', 'phone' => '+20 2 33773222', 'summary' => 'Palatial hotel with pyramid views, 40 acres of gardens, a heated pool and five restaurants.', 'mapsUrl' => 'https://maps.google.com/?cid=1', 'lat' => 29.9790, 'lng' => 31.1360, 'photos' => [['url' => $img('mena-house.jpg'), 'author' => 'Marriott Mena House, Cairo', 'official' => true], ['url' => $img('terrace.jpg'), 'author' => 'Marriott Mena House, Cairo', 'official' => true]], 'types' => ['lodging', 'spa', 'restaurant'], 'reviews' => [['text' => 'Woke up to the Great Pyramid filling the window. The gardens are an oasis after a day in the city, and breakfast on the terrace was the best of the trip.', 'rating' => 5, 'author' => 'A guest']], 'priceLevel' => 'PRICE_LEVEL_EXPENSIVE',
            ],
        ],
        'ai' => [
            'Marriott Mena House, Cairo' => 'A royal hunting lodge turned grand hotel, Mena House sits in forty acres of gardens at the foot of the Giza plateau, close enough that the Great Pyramid fills the view from the terrace. Your Deluxe room looks straight at it. Breakfast is served outside under the palms, there is a heated pool for the afternoon lull, and the city is a short drive away when you are ready for it.',
        ],
        'widgety' => [
            'ship|oberoi-philae' => [
                'name' => 'Oberoi Philae', 'operator' => 'Oberoi Nile Cruises', 'teaser' => 'Twenty-two cabins, a pool deck under the sun, and the Nile sliding past at walking pace.', 'intro' => '<p>The Oberoi Philae is a luxury Nile cruiser carrying just 44 guests between Luxor and Aswan. Cabins open onto private balconies; the sun deck has a heated pool; dinner is Egyptian and European cooking with the river for a view.</p>', 'cover' => $img('nile-ship.jpg'), 'profile' => '', 'video' => '',
                'facts' => ['Guests' => '44', 'Cabins' => '22', 'Crew' => '60', 'Launched' => '2015', 'Length (m)' => '72', 'Onboard currency' => 'USD'],
                'sections' => ['Accommodation' => [['name' => 'Luxury Cabin', 'text' => '<p>24 sq m with a floor-to-ceiling window and a small private balcony. Marble bathroom with rain shower; Nile-facing writing desk.</p>', 'images' => [$img('terrace.jpg')], 'video' => '']], 'Dining' => [['name' => 'The Restaurant', 'text' => '<p>Single-sitting dinner with a daily Egyptian table and à la carte alternatives. Vegan menus available with a day\'s notice.</p>', 'images' => [], 'video' => '']], 'Entertainment' => [], 'Enrichment' => [['name' => 'Resident Egyptologist', 'text' => '<p>Evening talks ahead of each temple visit, and a private tour of the Valley of the Kings.</p>', 'images' => [], 'video' => '']], 'Health & fitness' => [['name' => 'Spa & pool deck', 'text' => '<p>Two treatment rooms, a small gym and the heated sun-deck pool.</p>', 'images' => [], 'video' => '']], 'Kids & teens' => [], 'Deck plans' => [], 'Useful to know' => [['name' => 'Gratuities', 'text' => '<p>A discretionary USD 10 per guest per day is suggested and collected at the end of the voyage.</p>', 'images' => [], 'video' => '']]],
            ],
            'holiday|OBP-LXR-ASW-7' => [
                'reference' => 'OBP-LXR-ASW-7', 'name' => 'Luxor to Aswan, 7 nights', 'operator' => 'Oberoi Nile Cruises', 'ship' => 'Oberoi Philae', 'nights' => 7, 'starts' => $d(2), 'ends' => $d(9), 'description' => '<p>Seven nights downstream from Luxor to Aswan, with full days at Karnak and the Valley of the Kings before the river narrows past Esna, Edfu and Kom Ombo.</p>', 'highlights' => '', 'included' => '', 'images' => [$img('nile-ship.jpg')],
                'days' => [
                    ['day' => '1', 'date' => '', 'port' => 'Luxor', 'country' => 'Egypt', 'arrive' => '', 'depart' => '', 'text' => '<p>Embark after lunch. Evening visit to Luxor Temple, lit up.</p>', 'image' => $img('luxor.jpg'), 'atSea' => false],
                    ['day' => '2', 'date' => '', 'port' => 'Luxor', 'country' => 'Egypt', 'arrive' => '', 'depart' => '18:00', 'text' => '<p>Valley of the Kings, Hatshepsut and the Colossi of Memnon with the resident Egyptologist.</p>', 'image' => '', 'atSea' => false],
                    ['day' => '3', 'date' => '', 'port' => 'Esna', 'country' => 'Egypt', 'arrive' => '08:00', 'depart' => '13:00', 'text' => '<p>Pass through the Esna lock; afternoon sailing.</p>', 'image' => '', 'atSea' => false],
                    ['day' => '4', 'date' => '', 'port' => 'Edfu', 'country' => 'Egypt', 'arrive' => '07:00', 'depart' => '12:00', 'text' => '<p>Temple of Horus, the best preserved in Egypt.</p>', 'image' => '', 'atSea' => false],
                    ['day' => '5', 'date' => '', 'port' => 'Kom Ombo', 'country' => 'Egypt', 'arrive' => '15:00', 'depart' => '18:00', 'text' => '<p>The twin temple of Sobek and Haroeris at sunset.</p>', 'image' => '', 'atSea' => false],
                    ['day' => '6', 'date' => '', 'port' => 'Aswan', 'country' => 'Egypt', 'arrive' => '08:00', 'depart' => '', 'text' => '<p>Philae Temple by boat and the Old Cataract for tea.</p>', 'image' => '', 'atSea' => false],
                    ['day' => '7', 'date' => '', 'port' => 'Aswan', 'country' => 'Egypt', 'arrive' => '', 'depart' => '', 'text' => '<p>Optional Abu Simbel excursion; felucca at sunset.</p>', 'image' => '', 'atSea' => false],
                    ['day' => '8', 'date' => '', 'port' => 'Aswan', 'country' => 'Egypt', 'arrive' => '', 'depart' => '', 'text' => '<p>Disembark after breakfast.</p>', 'image' => '', 'atSea' => false],
                ],
            ],
        ],
        'flights' => [
            'aerodatabox|BA155|' . $d(0) => ['status' => 'en_route', 'statusLabel' => 'EnRoute', 'depScheduled' => '10:40', 'depActual' => '10:48', 'depTerminal' => '5', 'depGate' => 'B36', 'arrScheduled' => '17:05', 'arrActual' => '16:52', 'arrTerminal' => '3', 'arrGate' => '', 'baggage' => '12', 'aircraft' => 'Boeing 787-9', 'delayMinutes' => 0, 'updated' => '12:12'],
            'aerodatabox|MS355|' . $d(2) => ['status' => 'go_to_gate', 'statusLabel' => 'GateOpen', 'depScheduled' => '09:15', 'depActual' => '', 'depTerminal' => '3', 'depGate' => 'F7', 'arrScheduled' => '10:20', 'arrActual' => '', 'arrTerminal' => '', 'arrGate' => '', 'baggage' => '', 'aircraft' => 'Airbus A320', 'delayMinutes' => 0, 'updated' => '07:40'],
            'aerodatabox|BA154|' . $d(11) => ['status' => 'delayed', 'statusLabel' => 'Delayed', 'depScheduled' => '18:30', 'depActual' => '19:05', 'depTerminal' => '3', 'depGate' => 'F12', 'arrScheduled' => '22:25', 'arrActual' => '22:58', 'arrTerminal' => '5', 'arrGate' => '', 'baggage' => '7', 'aircraft' => 'Boeing 787-9', 'delayMinutes' => 35, 'updated' => '16:40'],
        ],
        'weather' => ['lat' => 29.98, 'lng' => 31.13, 'forecast' => ['temp' => 27, 'code' => 0, 'label' => 'Clear', 'icon' => 'sun', 'high' => 31, 'low' => 18, 'days' => []]],
        'widgety_places' => [
            'place|cairo-and-giza|egypt' => ['name' => 'Cairo', 'country' => 'Egypt', 'description' => '<p>Africa\'s largest city sprawls along the Nile with the Pyramids of Giza rising from its western edge. Expect noise, generosity and layer upon layer of history: Pharaonic, Coptic, Islamic and modern, often on the same street.</p>', 'images' => [$img('mena-house.jpg'), $img('egypt-hero.jpg')]],
            'place|luxor|egypt' => ['name' => 'Luxor', 'country' => 'Egypt', 'description' => '<p>Ancient Thebes. The east bank holds Karnak and Luxor temples; the west bank the Valley of the Kings, the Valley of the Queens and the temple of Hatshepsut. Mornings are for tombs, late afternoons for the river.</p>', 'images' => [$img('luxor.jpg')]],
        ],
        'places_any' => [
            'Cairo & Giza, Egypt' => ['id' => 'ChIJdemoCairo', 'name' => 'Giza', 'address' => 'Giza, Egypt', 'rating' => 0, 'ratings' => 0, 'website' => '', 'phone' => '', 'summary' => 'Giza is home to the Great Pyramid, the Sphinx and the Grand Egyptian Museum.', 'mapsUrl' => '', 'lat' => 29.9792, 'lng' => 31.1342, 'photos' => [['url' => $img('terrace.jpg'), 'author' => 'Visitor', 'official' => false]], 'types' => ['locality'], 'reviews' => [], 'priceLevel' => ''],
        ],
        'destguides' => [
            'destguide|v2|luxor|egypt|r|claude-sonnet-5-5' => ['overview' => 'Luxor is the ancient city of Thebes, strung along the east bank of the Nile with Karnak and Luxor temples at its heart and the Valley of the Kings across the water. It rewards early starts and slow afternoons: tombs and temples before the heat, the river and the corniche once it fades.', 'attractions' => 'Karnak, the largest religious complex ever built, is best at opening time, before the coach parties; the hypostyle hall alone is worth the trip. Across the river the Valley of the Kings holds the tomb of Tutankhamun and the painted corridors of Ramesses VI, with Hatshepsut\'s terraced temple nearby. Luxor Temple is magical after dark, floodlit and almost empty. The Luxor Museum is small, cool and superb.', 'practical' => 'Egyptian pounds from ATMs are easiest; tip small and often. Taxis and calèches need a price agreed first; your guide or cruise reception can arrange reliable drivers. Most sites open early and close mid-afternoon in summer. Dress modestly at religious sites and carry water; shade is scarce on the west bank.', 'culture' => 'Luxor is a conservative, hospitable town where a greeting of salaam alaikum opens doors. Tea is offered everywhere and it is polite to accept. Bargaining in the souk is expected and good-humoured. Friday is the day of rest; some shops close for midday prayers.'],
        ],
        'guides' => [
            'guide|airline|british airways|ba|claude-sonnet-4-6' => [['title' => 'Check-in and boarding passes', 'text' => 'Online check-in opens the day before departure through the British Airways app or website; boarding passes can be saved to your phone wallet. Check-in desks and bag drop at Heathrow Terminal 5 are also available on the day.'], ['title' => 'Baggage', 'text' => 'Allowances depend on your fare and cabin. Club World includes checked bags and a cabin bag plus a personal item; check the current allowance in your booking confirmation or the app before you pack.'], ['title' => 'Seats and extras', 'text' => 'Seat selection is included in Club World and can be changed in Manage My Booking. Special meals, including vegan, can be requested there at least 24 hours before departure.'], ['title' => 'On board', 'text' => 'Club World offers a lie-flat seat, a full meal service and complimentary drinks. The Executive Club is British Airways\' loyalty programme if you would like to collect Avios on this flight.']],
            'guide|airport|london heathrow|lhr|claude-sonnet-4-6' => [['title' => 'Getting there and parking', 'text' => 'Heathrow is on the Piccadilly line, the Elizabeth line and the Heathrow Express from Paddington. Pre-booked parking is cheaper than drive-up rates; we can arrange this for you.'], ['title' => 'Terminals and check-in', 'text' => 'British Airways long-haul flights depart from Terminal 5. Allow around three hours before a long-haul departure, more at peak times.'], ['title' => 'Security and what to expect', 'text' => 'Liquids rules apply; check the airport website for current limits. Assistance can be pre-booked through the airline if anyone needs help through the terminal.'], ['title' => 'Lounges, food and shops', 'text' => 'Terminal 5 has lounges you can pre-book, plus restaurants and shops after security. Club World passengers can use the British Airways lounges.']],
        ],
    ];

    return ['graph' => $graph, 'mocks' => $mocks];
};
