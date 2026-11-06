<?php
/**
 * Default legal / consumer texts. Placeholders: {organiser} {retailer} {member} {protection} {atol} {regulator}.
 * These are plain-English summaries with links to the statutory sources. They are editable in
 * wp-admin → Vision Trips → Legal and MUST be reviewed by TTNG compliance before go-live.
 */
return [
    'ptr_package' => [
        'label' => 'Package travel — standard information (PTR 2018, Schedule 1)',
        'text'  => "The combination of travel services offered to you is a package within the meaning of the Package Travel and Linked Travel Arrangements Regulations 2018, so you benefit from all rights that apply to packages. {organiser} is responsible for the proper performance of the package as a whole and, as required by law, has protection in place to refund your payments and, where transport is included, to bring you home if it becomes insolvent.\n\nYour key rights include: receiving all essential information before you book; one trader being liable for all the travel services in the contract; an emergency contact point; the ability to transfer the booking to another person on reasonable notice (fees may apply); limits on price increases (only for specified costs, not within 20 days of departure, with a right to cancel if an increase exceeds 8%); the right to cancel without a fee and receive a full refund if an essential element other than price is changed significantly, if the package is cancelled by the organiser, or in the event of unavoidable and extraordinary circumstances at the destination; the right to cancel at any time before departure on payment of an appropriate termination fee; suitable alternative arrangements at no extra cost if significant parts of the package cannot be provided; a price reduction and/or compensation where services are not performed or are performed improperly; assistance if you are in difficulty; and a refund (and repatriation where transport is included) if the organiser becomes insolvent.\n\nInsolvency protection for this package is provided by {protection}. If services are refused because of the organiser's insolvency you may contact that entity or the competent authority ({regulator}).\n\nFull text: https://www.legislation.gov.uk/uksi/2018/634/schedule/1",
    ],
    'lta_notice' => [
        'label' => 'Not a package — linked travel arrangement notice (PTR 2018, Schedule 2)',
        'text'  => "The travel services on this booking have been arranged under separate contracts with the individual providers. They are NOT a package within the meaning of the Package Travel and Linked Travel Arrangements Regulations 2018, so you do not benefit from the rights that apply to packages, and {retailer} is not responsible for the performance of each service. If something goes wrong with a service, contact the provider of that service.\n\nWhere services were booked with {retailer} within 24 hours of each other they form a linked travel arrangement. {retailer} has, as required by law, protection in place to refund payments made to {retailer} for services not performed because of {retailer}'s insolvency. This protection does not cover the insolvency of the individual providers.\n\nFull text: https://www.legislation.gov.uk/uksi/2018/634/schedule/2",
    ],
    'ticket_agent' => [
        'label' => 'Flight sold as airline ticket agent — not ATOL protected',
        'text'  => "This flight has been sold by {retailer} as an agent of the airline. It is not ATOL protected. Your contract for the flight is with the airline and its conditions of carriage apply. We recommend travel insurance that includes scheduled airline failure cover.",
    ],
    'atol_statement' => [
        'label' => 'ATOL protection statement (flight-inclusive)',
        'text'  => "Many of the flights and flight-inclusive holidays on this site are financially protected by the ATOL scheme, but ATOL protection does not apply to all holiday and travel services. This booking is protected under {atol}. Please ask us to confirm what protection may apply to your booking. If you do not receive an ATOL Certificate, the booking will not be ATOL protected. If you do receive an ATOL Certificate but all the parts of your trip are not listed on it, those parts will not be ATOL protected. For more information about financial protection and the ATOL Certificate go to www.atol.org.uk/ATOLCertificate.",
    ],
    'trust_statement' => [
        'label' => 'Trust account statement (non-ATOL money)',
        'text'  => "Money you pay to {member} for arrangements that are not covered by ATOL is held in {protection} until it is passed to the supplier of each service, as a safeguard in the event of {member}'s insolvency.",
    ],
    'cancellation' => [
        'label' => 'Cancellation and cooling-off',
        'text'  => "Holiday and travel bookings for specific dates are exempt from the 14-day cooling-off period that applies to many other distance purchases. Once you accept, cancellation charges apply as set out in the booking conditions: deposits are normally non-refundable and charges increase closer to departure. You may cancel at any time before departure on payment of the applicable charge.",
    ],
    'insurance' => [
        'label' => 'Travel insurance',
        'text'  => "We strongly recommend that everyone travelling has comprehensive travel insurance from the moment you book, covering cancellation, medical expenses and repatriation, and any activities you plan to do. We are not able to advise on individual policies.",
    ],
    'entry_health' => [
        'label' => 'Passports, visas and health',
        'text'  => "Entry requirements depend on your nationality and destination and can change. Check the latest advice for every country you will visit or pass through at gov.uk/foreign-travel-advice and travelhealthpro.org.uk, including passport validity rules, visa or travel-authorisation requirements and the time needed to obtain them, and recommended vaccinations.",
    ],
    'accessibility' => [
        'label' => 'Accessibility statement',
        'text'  => "We want everyone to be able to use their trip page. It works with screen readers, keyboard navigation and text up to 200%, respects reduced-motion and dark-mode settings, and keeps colour contrast at or above WCAG 2.2 AA. Every document can be downloaded as a PDF. If anything is hard to use, or you need your travel details in another format, contact your travel agent and they will arrange it.",
    ],
    'assistance' => [
        'label' => 'Reduced mobility and special requirements',
        'text'  => "Tell us before you book about any mobility, medical, dietary or other requirements so we can check that the arrangements are suitable and tell the providers.",
    ],
];
