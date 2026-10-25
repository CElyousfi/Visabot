/* data.js — destinations, centres and categories shared by the popup and the dashboard. */
'use strict';

/* Moroccan Schengen landscape (France excluded: random allocation, nothing to watch). */
const DESTINATIONS = [
  { id: 'spain', name: 'Spain · Espagne', provider: 'BLS International', portal: 'https://www.blsspainmorocco.com/',
    centres: ['Casablanca', 'Rabat', 'Tanger', 'Nador', 'Tétouan', 'Agadir'] },
  { id: 'portugal', name: 'Portugal', provider: 'BLS International', portal: 'https://www.blsinternational.com/',
    centres: ['Casablanca', 'Rabat', 'Tanger', 'Other'] },
  { id: 'italy', name: 'Italy · Italie', provider: 'VFS Global', portal: 'https://visa.vfsglobal.com/mar/en/ita',
    centres: ['Casablanca', 'Rabat', 'Tanger', 'Other'] },
  { id: 'netherlands', name: 'Netherlands · Pays-Bas', provider: 'VFS Global', portal: 'https://visa.vfsglobal.com/mar/en/nld',
    centres: ['Rabat', 'Tanger', 'Other'] },
  { id: 'germany', name: 'Germany · Allemagne', provider: 'VFS Global', portal: 'https://visa.vfsglobal.com/mar/en/deu',
    centres: ['Casablanca', 'Rabat', 'Other'] },
  { id: 'switzerland', name: 'Switzerland · Suisse', provider: 'VFS Global', portal: 'https://visa.vfsglobal.com/mar/en/che',
    centres: ['Rabat', 'Casablanca', 'Other'] },
  { id: 'belgium', name: 'Belgium · Belgique', provider: 'VFS Global', portal: 'https://visa.vfsglobal.com/mar/en/bel',
    centres: ['Casablanca', 'Rabat', 'Other'] },
  { id: 'austria', name: 'Austria · Autriche', provider: 'VFS Global', portal: 'https://visa.vfsglobal.com/mar/en/aut',
    centres: ['Rabat', 'Other'] },
  { id: 'other', name: 'Other Schengen country', provider: 'Check the embassy site', portal: '',
    centres: ['Casablanca', 'Rabat', 'Tanger', 'Marrakech', 'Fès', 'Agadir', 'Oujda', 'Nador', 'Tétouan', 'Other'] },
  { id: 'france', name: 'France (not supported)', provider: 'TLScontact – random allocation', portal: 'https://visas-fr.tlscontact.com/',
    centres: [], unsupported: true },
];

const CATEGORIES = [
  'Tourism · Tourisme', 'Family / friends visit · Visite familiale', 'Business · Affaires', 'Study · Études',
  'Medical · Médical', 'Work · Travail', 'Family reunification · Regroupement familial', 'Transit', 'Other · Autre',
];

/* Documents most Schengen consulates ask for. The provider's own list is the reference. */
const CHECKLIST = [
  ['passport', 'Passport (valid 3+ months after return, issued in the last 10 years) + copy'],
  ['photos', '2 recent photos, 35 × 45 mm, white background'],
  ['form', 'Visa application form, filled in and signed'],
  ['insurance', 'Travel medical insurance, €30,000 minimum, whole Schengen area'],
  ['flight', 'Return flight reservation'],
  ['stay', 'Accommodation proof (hotel booking or invitation letter)'],
  ['bank', 'Bank statements, last 3–6 months'],
  ['job', 'Employment certificate / payslips, or school enrolment'],
  ['fee', 'Visa fee + service fee'],
  ['confirmation', 'Appointment confirmation, printed'],
];

function destinationById(id) { return DESTINATIONS.find(d => d.id === id); }
