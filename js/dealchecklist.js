// js/dealchecklist.js
// The task list for a newly accepted buy-side deal (deal_checklist rows).
//
// Pure: no database, no DOM. Pipeline.generateChecklist (js/offers.js) calls
// DealChecklist.tasks() and inserts the result. Kept separate so the rules can
// be unit tested (tests/unit/dealchecklist.test.js loads this exact file).
//
// Rules:
//   - inspection tasks only when inspection was NOT skipped (offer.inspection_skipped)
//   - the sale-of-property task only when there is a sale condition date
//   - dates are local calendar days (YYYY-MM-DD), never shifted through UTC

const DealChecklist = {
  // 'YYYY-MM-DD' + n days → 'YYYY-MM-DD'. Works on the calendar date itself,
  // so a daylight-saving change can never move the answer by a day (the old
  // inline helper went through toISOString and could land a day early in spring).
  addDays(base, n) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(base || ''));
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
    return d.toISOString().slice(0, 10);
  },

  tasks(offer, acceptDate) {
    const o = offer || {};
    const add = (base, n) => DealChecklist.addDays(base, n);
    const day = v => (v ? String(v).slice(0, 10) : null);
    const noInspection = !!o.inspection_skipped;

    return [
      // Legal
      { title: 'Retain a real estate lawyer / notary', category: 'Legal', due: add(acceptDate, 2) },
      { title: 'Send accepted offer documents to lawyer', category: 'Legal', due: add(acceptDate, 3) },
      { title: 'Confirm deposit payment to listing brokerage', category: 'Legal', due: add(acceptDate, 5) },
      { title: 'Review lawyer\'s title search and insurance', category: 'Legal', due: add(acceptDate, 10) },
      // Financing
      { title: 'Confirm client has submitted mortgage application', category: 'Financing', due: add(acceptDate, 3) },
      { title: 'Provide all required documents to mortgage lender', category: 'Financing', due: add(acceptDate, 5) },
      { title: 'Confirm mortgage approval with lender', category: 'Financing', due: add(acceptDate, 8) },
      { title: 'Ensure financing condition is waived or extended', category: 'Financing', due: day(o.financing_date) || add(acceptDate, 10) },
      // Inspection, only when there is one
      ...(noInspection ? [] : [
        { title: 'Book home inspection appointment', category: 'Inspection', due: add(acceptDate, 3) },
        { title: 'Attend home inspection with client', category: 'Inspection', due: add(acceptDate, 7) },
        { title: 'Review inspection report and negotiate repairs if needed', category: 'Inspection', due: add(acceptDate, 9) },
        { title: 'Ensure inspection condition is waived or resolved', category: 'Inspection', due: day(o.inspection_date) || add(acceptDate, 10) },
      ]),
      // Sale of the buyer's own home (Schedule A). Only when it is a condition.
      ...(o.sale_condition_date ? [
        { title: 'Ensure the sale-of-property condition is met or waived in writing', category: 'Legal', due: day(o.sale_condition_date) },
      ] : []),
      // Insurance & Utilities
      { title: 'Remind client to arrange home insurance', category: 'General', due: add(acceptDate, 14) },
      { title: 'Remind client to transfer utilities (hydro, water, gas, internet)', category: 'General', due: add(acceptDate, 21) },
      // Moving
      { title: 'Remind client to book a moving company', category: 'Moving', due: add(acceptDate, 14) },
      { title: 'Confirm moving date and logistics with client', category: 'Moving', due: add(acceptDate, 28) },
      // Walkthrough & Closing
      { title: 'Schedule final walkthrough with client', category: 'General', due: day(o.walkthrough_date) || add(acceptDate, 28) },
      { title: 'Conduct final walkthrough of the property', category: 'General', due: day(o.walkthrough_date) || add(acceptDate, 28) },
      { title: 'Confirm all conditions have been met and waived', category: 'Legal', due: add(acceptDate, 12) },
      { title: 'Confirm closing costs with lawyer (client must prepare bank draft)', category: 'Legal', due: o.closing_date ? add(o.closing_date, -3) : add(acceptDate, 25) },
      { title: 'Coordinate key handover with listing agent', category: 'General', due: day(o.closing_date) || add(acceptDate, 30) },
      { title: 'Post-closing: send congratulations and request Google review', category: 'General', due: o.closing_date ? add(o.closing_date, 3) : add(acceptDate, 33) },
    ];
  }
};

if (typeof window !== 'undefined') window.DealChecklist = DealChecklist;
