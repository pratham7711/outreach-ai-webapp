/** The creator page's breakpoints, shared by the page and its loading screen. */
export const responsiveStyles = `
  .cd-stats { margin-bottom: 24px; }
  /* Two column stacks rather than one grid: five cards in a 2-column grid
     left "On lists" alone in its row and stretched Notes to the height of
     About. Each stack is as tall as its own cards. */
  .cd-profile {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 24px;
    align-items: start;
  }
  .cd-profile-col {
    display: flex;
    flex-direction: column;
    gap: 24px;
    min-width: 0;
  }
  .cd-empty-line {
    margin: 0;
    font-size: var(--cc-t-14);
    line-height: 1.5;
    color: var(--cc-text-muted);
  }
  .cd-bio {
    margin: 0;
    font-size: var(--cc-t-14);
    line-height: 1.6;
    color: var(--cc-text);
  }
  /* Label over value, in a 2-column grid: the label is the muted 12px line,
     the value 14px medium in the ink. */
  .cd-facts {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 20px 32px;
    margin: 0;
  }
  .cd-bio + .cd-facts { margin-top: 20px; }
  .cd-facts > div { min-width: 0; }
  .cd-facts dt {
    margin: 0 0 4px;
    font-size: var(--cc-t-12);
    color: var(--cc-text-muted);
  }
  .cd-facts dd {
    margin: 0;
    font-size: var(--cc-t-14);
    font-weight: var(--cc-fw-medium);
    color: var(--cc-text);
    overflow-wrap: anywhere;
    font-variant-numeric: tabular-nums;
  }
  .cd-facts dd[data-figure] {
    font-size: var(--cc-t-18);
    font-weight: 700;
  }
  .cd-account-foot {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 16px;
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--cc-border);
    font-size: var(--cc-t-12);
    color: var(--cc-text-muted);
  }
  .cd-account-foot > span { display: inline-flex; align-items: center; gap: 6px; }
  .cd-section-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }
  .cd-section-head h2 {
    margin: 0;
    font-size: var(--cc-t-16);
    font-weight: 600;
    color: var(--cc-text);
  }
  .cd-post-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .cd-post-stat {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--cc-t-13);
    color: var(--cc-text-muted);
    font-variant-numeric: tabular-nums;
  }
  .cd-social-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
  }

  @media (min-width: 480px) {
    .cd-social-grid { grid-template-columns: repeat(2, 1fr); }
  }

  @media (min-width: 900px) {
    .cd-profile { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .cd-social-grid { grid-template-columns: repeat(3, 1fr); }
  }
`;
