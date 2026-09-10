# Shared history fixture

The category icons, measure-rail interaction, and sticky-offset synchronization are derived from the MIT-licensed [Hraness Stripe History source](https://github.com/hraness/stripe-history/tree/39ee479daeebea668230a581553517b7ec2a1e1d/app/history). The original files are `category-icon.tsx`, `history-measure-rail.tsx`, and `history-sticky-offset-sync.tsx`.

The fixture preserves their finite icon map, scrolling and reduced-motion behavior, and resize-observer lifecycle. Its local finite type replaces the product-private schema import. Product CSS is replaced by fixture-owned compiled geometry. A server-authored definition key and the cards describe measures rather than reporting financial data. The key and the directly rendered card headings mirror the original `history-view.tsx` → `history-event-article.tsx` and direct icon import paths, without namespace or side-effect imports. The same client modules are consumed only by the two delegated routes; the root route retains its separate existing client proof. This is a representative application boundary, not a promise that webpack must always choose a particular chunk topology.

MIT License

Copyright (c) 2026 Hraness

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
