The PDF is copied byte-for-byte from `tests/fixtures/sites/site/pdf/doc.pdf`.

The PPTX is Apache POI's existing `templatePPTWithOnlyOneText.pptx` test deck, copied unchanged as `slides.pptx`:

- Commit: `ae62bb5116b9aee19ebd5834e3a82066132c9f7f`
- [Source](https://github.com/apache/poi/blob/ae62bb5116b9aee19ebd5834e3a82066132c9f7f/test-data/slideshow/templatePPTWithOnlyOneText.pptx)
- [Apache 2.0 licence](https://github.com/apache/poi/blob/ae62bb5116b9aee19ebd5834e3a82066132c9f7f/LICENSE)
- SHA-256: `aafbbdd776c49e44fcb9392227c96ff1053a036fa6d612739890c5ae5a9eafff`

These are disposable application-opening fixtures, not captured user notes. No model authors or rewrites their contents.

The budget reserves 4096 input tokens per verified 1280×800 PNG, one token per non-image UTF-8 byte, and 4096 overhead tokens. [OpenAI's vision rules](https://developers.openai.com/api/docs/guides/images-vision) give this screen 40×25 patches and a 1.2 multiplier (about 1200 tokens). The reservation uses the repository price table's dearest input category (cache writes), long-context adjustments, and the hard 768 output-token limit. An ambiguous paid request retains its entire reservation and stops the trial. No retries.
