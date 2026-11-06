<?php
/**
 * Demo booking: "Lisbon long weekend" with Harbour & Hill Travel — a Global member, city theme, casual tone.
 */
declare(strict_types=1);

return static function (string $stage, callable $img): array {
    $today = new DateTimeImmutable('today', new DateTimeZone('Europe/London'));
    $offset = match ($stage) { 'quote' => 64, 'countdown' => 40, 'prep' => 3, 'departure' => 0, 'travelling' => -1, 'home' => -6, default => 40 };
    $d = static fn (int $days) => $today->modify(($days + $offset >= 0 ? '+' : '') . ($days + $offset) . ' days')->format('Y-m-d');
    $status = $stage === 'quote' ? 'Quotation' : 'Confirmed';
    $paid = $stage === 'quote' ? 0 : ($offset > 30 ? 300.00 : 1396.00);

    $booking = ['id' => 'recB00K1NG000002B', 'fields' => [
        'Booking Reference' => 'HHT-10422', 'Trip Name' => 'Lisbon long weekend', 'Status' => $status,
        'Tags' => ['City', 'Short Haul'], 'Holiday Type(s)' => ['City'], 'Traveller Type' => 'Friends', 'Sector' => 'Europe & Short Breaks',
        'Departure Date' => [$d(0)], 'Return Date' => [$d(3)], 'Trip Duration' => 3, 'Countries' => ['Portugal'],
        'Destinations' => ['recL0C000000LISBN'],
        'Hero Image' => [['url' => $img('lisbon-hero.jpg'), 'type' => 'image/jpeg', 'filename' => 'lisbon.jpg']],
        'Total Price' => 1396.00, 'MS Paid' => $paid, 'MS Outstanding ' => 1396.00 - $paid,
        'balanceDueDate' => [$d(-28)],
        'Customers' => ['recCUST000000002B'], 'Customers [People]' => ['recPE0PLE0000003B', 'recPE0PLE0000004B'],
        'Bookings [Elements]' => ['recELEM000000011B', 'recELEM000000012B', 'recELEM000000013B', 'recELEM000000014B'],
        'Bookings [Payments]' => ['recPAY0000000011B', 'recPAY0000000012B'],
        'Upsells' => ['recUPS0000000011B'],
        'Brands & Branches' => ['recBRAND00000002B'], 'Members' => ['recMEMBER0000002B'],
        'Member | Proposition' => ['Global'], 'Members | Company Name' => ['Harbour & Hill Travel Ltd'], 'Members | Number' => ['G2210'],
        'Personalised Message' => "Here's the Lisbon weekend! Flights from Bristol so no faff, a hotel in Chiado that's a two-minute walk to everything, and I've put a tram-28-then-pastéis morning in the notes for you. Shout if you want to add the day trip to Sintra.",
        'Include Personalised Message' => true, 'SinGS Agent Name' => 'Dan Ashworth',
        'Created time' => $today->modify('-5 days')->format(DATE_ATOM), 'Quotation Expiry' => $today->modify('+5 days')->format('Y-m-d'),
        'ATOL' => 'Single-Contract Package',
        'Licensing' => 'Single-contract Package (Principal/Package Organiser)', 'ATOL No.' => ['3973'], 'Total Passengers & Guests' => 2,
        'Customers | Email' => ['priya.n@example.com'], 'Customers | Postcode' => ['BS8 4TQ'], 'Currency' => ['GBP'],
        'Booking Confirmation' => $stage !== 'quote', 'Booking Reconfirmed' => $offset <= 20, 'Travel Documents' => $offset <= 3, 'Pre-Departure Call' => false, 'Post-Travel Follow-Up' => $stage === 'home',
    ]];
    $brand = ['id' => 'recBRAND00000002B', 'fields' => [
        'Trading Name' => 'Harbour & Hill Travel', 'Company Name' => ['Harbour & Hill Travel Ltd'], 'Proposition' => ['Global'],
        'Primary Colour' => '#D1462F', 'Secondary Colour' => '#1E2A38', 'Slogan' => 'Proper holidays, properly looked after', 'Member Tone' => 'Casual (Bucket & Spade)',
        'Logo' => [['url' => $img('hh-logo.svg'), 'type' => 'image/svg+xml', 'filename' => 'logo.svg']],
        'Customer | Telephone' => '0117 496 0123', 'Customer | Email Address' => 'hello@harbourandhill.co.uk', 'Customer | Website' => 'harbourandhill.co.uk', 'Customer | Emergency Telephone' => '07700 900789',
        'Physical Address' => true, 'Shop | Address Line 1' => '8 Princess Victoria Street', 'Shop | Town/City' => 'Clifton, Bristol', 'Shop | Post Code' => 'BS8 4BP',
        'Social Media: Instagram' => '@harbourandhill', 'Trustpilot Reviews URL' => 'https://uk.trustpilot.com/review/harbourandhill.co.uk', 'Display Logos' => ['ATOL', 'The Global Travel Group'],
        'Trust Account | Account Name' => 'Harbour & Hill Travel Client Trust', 'Trust Account | Sort Code' => '40-22-19', 'Trust Account | Account Number' => '87654321',
        'Template | Terms & Conditions' => 'Your contract is with Harbour & Hill Travel Ltd as package organiser. Deposits are non-refundable. Balances are due 8 weeks before departure.',
        'Template | Important Information' => 'UK passports must have been issued within the last 10 years and be valid for at least 3 months after you leave the EU.',
        'Template | Financial Protection Information' => 'This flight-inclusive package is protected under The Global Travel Group Ltd ATOL 3973. Your ATOL Certificate will be issued on confirmation.',
    ]];
    $member = ['id' => 'recMEMBER0000002B', 'fields' => ['Company Name' => 'Harbour & Hill Travel Ltd', 'Member Number' => 'G2210', 'Company Registration Number' => '11223344', 'Registered Office | Address Line 1' => '8 Princess Victoria Street', 'Registered Office | Town/City' => 'Bristol', 'Registered Office | Post Code' => 'BS8 4BP', 'Registered Office (Country)' => 'United Kingdom', 'Proposition' => 'Global']];
    $customers = [['id' => 'recCUST000000002B', 'fields' => ['Full Name' => 'Ms Priya Nair', 'First Name' => 'Priya', 'Last Name' => 'Nair', 'Primary Email' => 'priya.n@example.com', 'Address Post Code' => 'BS8 4TQ']]];
    $people = [['id' => 'recPE0PLE0000003B', 'fields' => ['Full Name' => 'Priya Nair', 'First Name' => 'Priya', 'Last Name' => 'Nair', 'Date of Birth' => '1991-02-14', 'Age' => 35]], ['id' => 'recPE0PLE0000004B', 'fields' => ['Full Name' => 'Megan Hughes', 'First Name' => 'Megan', 'Last Name' => 'Hughes', 'Date of Birth' => '1990-11-02', 'Age' => 36]]];
    $elements = [
        ['id' => 'recELEM000000011B', 'fields' => ['Type' => 'Flight', 'Status' => 'Confirmed', 'Pick Up Date' => $d(0), 'Return Date' => $d(0), 'Depart Time' => '06:55', 'Arrival Time' => '09:40', 'Carrier' => ['recAIRL000000003B'], 'Flight No.' => 'U26181', 'Flight Class' => 'Economy', 'Dep. Airport Name' => ['recAPRT000000BRS0'], 'Arr. Airport Name' => ['recAPRT000000LIS0'], 'Direction' => 'Outbound', 'Supplier' => ['recSUPP000000011B'], 'Supplier Reference' => 'K7P2RD', 'Package' => true]],
        ['id' => 'recELEM000000012B', 'fields' => ['Type' => 'Accommodation', 'Status' => 'Confirmed', 'Pick Up Date' => $d(0), 'Return Date' => $d(3), 'Trip Element Heading' => 'Hotel do Chiado', 'Address' => 'Rua Nova do Almada 114, Lisbon', 'Rating' => ['4'], 'Rooms' => ['recROOM000000011B'], 'Location' => ['recL0C000000LISBN'], 'Supplier' => ['recSUPP000000012B'], 'Supplier Reference' => 'HDC-5512', 'Package' => true, 'Further Information' => 'Rooftop bar opens at 5pm — the view over the Tagus is the reason we picked it. Check-in from 3pm; they will hold bags if you arrive early.']],
        ['id' => 'recELEM000000013B', 'fields' => ['Type' => 'Attractions', 'Status' => 'Confirmed', 'Pick Up Date' => $d(1), 'Start Time' => '10:00', 'Event Name' => 'Tram 28 & pastéis de nata tasting walk', 'Pick Up Location' => 'Praça Martim Moniz', 'Supplier' => ['recSUPP000000013B'], 'Supplier Reference' => 'WLK-2291', 'Further Information' => 'Three hours on foot through Alfama and Graça with a local guide, finishing with a tasting of three bakeries. Wear comfortable shoes.']],
        ['id' => 'recELEM000000014B', 'fields' => ['Type' => 'Flight', 'Status' => 'Confirmed', 'Pick Up Date' => $d(3), 'Return Date' => $d(3), 'Depart Time' => '20:10', 'Arrival Time' => '22:50', 'Carrier' => ['recAIRL000000003B'], 'Flight No.' => 'U26182', 'Flight Class' => 'Economy', 'Dep. Airport Name' => ['recAPRT000000LIS0'], 'Arr. Airport Name' => ['recAPRT000000BRS0'], 'Direction' => 'Inbound', 'Supplier' => ['recSUPP000000011B'], 'Supplier Reference' => 'K7P2RD', 'Package' => true]],
    ];
    if ($stage === 'quote') {
        foreach ($elements as &$el) { $el['fields']['Status'] = 'Quotation'; }
        unset($el);
    }
    $payments = [
        ['id' => 'recPAY0000000011B', 'fields' => ['Amount' => 300.00, 'Payment Type' => 'Customer Payment', 'Customer Payment Type' => 'Deposit Payment', 'Status' => $stage === 'quote' ? 'Outstanding' : 'Complete', 'Date Due' => $today->modify('-4 days')->format('Y-m-d'), 'Payment Complete' => $stage === 'quote' ? null : $today->modify('-4 days')->format('Y-m-d'), 'Payment Link URL' => 'https://hpp.mintpayments.com/demo/deposit', "Show 'Pay Now' on Quotation" => true, 'paymentReference' => 'HHT-10422-D1']],
        ['id' => 'recPAY0000000012B', 'fields' => ['Amount' => 1096.00, 'Payment Type' => 'Customer Payment', 'Customer Payment Type' => 'Balance Payment', 'Status' => $offset > 30 || $stage === 'quote' ? 'Outstanding' : 'Complete', 'Date Due' => $d(-28), 'Payment Complete' => $offset > 30 || $stage === 'quote' ? null : $d(-30), 'Payment Link URL' => 'https://hpp.mintpayments.com/demo/balance', 'paymentReference' => 'HHT-10422-B1']],
    ];
    $upsells = [['id' => 'recUPS0000000011B', 'fields' => ['Name' => 'Sintra & Cascais day trip', 'Further Information' => 'Pena Palace, the Moorish castle and fish for lunch in Cascais. Small group, hotel pick-up. From £79 per person.']]];
    $locations = [['id' => 'recL0C000000LISBN', 'fields' => ['Name' => 'Lisbon', 'Country' => 'Portugal', 'Latitude' => 38.7223, 'Longitude' => -9.1393, 'Featured Image' => [['url' => $img('lisbon-hero.jpg'), 'type' => 'image/jpeg', 'filename' => 'lisbon.jpg']], 'Destination Overview' => 'Seven hills, yellow trams and a river that looks like the sea. Lisbon is cheap to eat in, easy to walk and lit like a film set after dark.', 'Key Attractions/Experiences' => "- Alfama at breakfast time\n- The Time Out Market\n- Belém: the tower, the monastery and the original pastéis\n- Sunset at the Miradouro de Santa Catarina", 'Practical Information' => 'Buy a Viva Viagem card for trams and metro. Hills are steep: the Santa Justa lift and the Bica funicular save legs.']]];
    $w3 = [
        'suppliers' => [['id' => 'recSUPP000000011B', 'fields' => ['Name' => 'easyJet']], ['id' => 'recSUPP000000012B', 'fields' => ['Name' => 'Hotelbeds']], ['id' => 'recSUPP000000013B', 'fields' => ['Name' => 'Lisbon Walker']]],
        'airports' => [['id' => 'recAPRT000000BRS0', 'fields' => ['Name' => 'Bristol', 'IATA Code' => 'BRS', 'ISO Country' => 'GB']], ['id' => 'recAPRT000000LIS0', 'fields' => ['Name' => 'Lisbon Humberto Delgado', 'IATA Code' => 'LIS', 'ISO Country' => 'PT']]],
        'airlines' => [['id' => 'recAIRL000000003B', 'fields' => ['Airline' => 'easyJet', 'iata' => 'U2']]],
        'rooms' => [['id' => 'recROOM000000011B', 'fields' => ['Room Type' => 'Twin room', 'Board Basis' => 'Bed & Breakfast']]],
        'cabins' => [], 'passengers' => [], 'ships' => [], 'itinerary' => [], 'elocations' => $locations, 'operators' => [], 'templates' => [], 'methods' => [],
    ];
    $graph = ['fetched_at' => time(), 'booking' => $booking, 'w2' => ['brand' => [$brand], 'member' => [$member], 'customers' => $customers, 'people' => $people, 'elements' => $elements, 'payments' => $payments, 'upsells' => $upsells, 'locations' => $locations], 'w3' => $w3, 'ports' => []];
    $mocks = [
        'places' => ['Hotel do Chiado, Rua Nova do Almada 114, Lisbon' => ['id' => 'ChIJdemoChiado', 'name' => 'Hotel do Chiado', 'address' => 'R. Nova do Almada 114, 1200-290 Lisboa, Portugal', 'rating' => 4.5, 'ratings' => 1872, 'website' => 'https://www.hoteldochiado.pt', 'phone' => '+351 21 325 6100', 'summary' => 'Boutique hotel atop the Armazéns do Chiado with a rooftop bar overlooking the river and castle.', 'mapsUrl' => '', 'lat' => 38.7107, 'lng' => -9.1399, 'photos' => [['url' => $img('lisbon-hotel.jpg'), 'author' => 'Hotel do Chiado', 'official' => true]], 'types' => ['lodging', 'bar'], 'reviews' => [['text' => 'Perfect location and the terrace at sunset is unbeatable. Rooms are compact but spotless.', 'rating' => 5, 'author' => 'A guest']], 'priceLevel' => '']],
        'ai' => ['Hotel do Chiado' => 'Hotel do Chiado sits on the top floors of the Armazéns do Chiado, right where Baixa meets Bairro Alto, so most of the city is within a ten-minute walk. Rooms are compact and calm; the draw is the rooftop terrace, where the view runs from the castle across the rooftops to the Tagus. Breakfast is included and the Baixa-Chiado metro is directly below.'],
        'widgety' => [],
        'flights' => ['aerodatabox|U26181|' . $d(0) => ['status' => 'on_time', 'statusLabel' => 'Expected', 'depScheduled' => '06:55', 'depActual' => '06:55', 'depTerminal' => '', 'depGate' => '4', 'arrScheduled' => '09:40', 'arrActual' => '09:31', 'arrTerminal' => '1', 'arrGate' => '', 'baggage' => '', 'aircraft' => 'Airbus A320', 'delayMinutes' => 0, 'updated' => '05:30']],
        'weather' => ['lat' => 38.72, 'lng' => -9.14, 'forecast' => ['temp' => 19, 'code' => 2, 'label' => 'Mostly sunny', 'icon' => 'sun-cloud', 'high' => 21, 'low' => 13, 'days' => []]],
        'widgety_places' => [], 'places_any' => ['Lisbon, Portugal' => ['id' => 'ChIJdemoLisbon', 'name' => 'Lisbon', 'address' => 'Lisbon, Portugal', 'rating' => 0, 'ratings' => 0, 'website' => '', 'phone' => '', 'summary' => 'Hilly coastal capital known for its trams, tiled façades, fado music and views over the Tagus.', 'mapsUrl' => '', 'lat' => 38.7223, 'lng' => -9.1393, 'photos' => [['url' => $img('lisbon-hero.jpg'), 'author' => 'Visitor', 'official' => false], ['url' => $img('lisbon-hotel.jpg'), 'author' => 'Visitor', 'official' => false]], 'types' => ['locality'], 'reviews' => [], 'priceLevel' => '']], 'guides' => [],
    ];
    return ['graph' => $graph, 'mocks' => $mocks];
};
