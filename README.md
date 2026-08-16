# Procedural Engine Sounds Dataset — project page

### https://rdoerfler.github.io/procedural-engine-sounds-page/

This repo hosts the landing page for the Procedural Engine Sounds Dataset.
The dataset itself lives elsewhere:

- Dataset: [Hugging Face](https://huggingface.co/datasets/rdoerfler/procedural-engine-sounds)
- Archived release: [Zenodo, DOI 10.5281/zenodo.16883336](https://doi.org/10.5281/zenodo.16883336)
- Paper: [arXiv:2603.07584](https://arxiv.org/abs/2603.07584)
- Analysis code: [rdoerfler/engine-order-analysis](https://github.com/rdoerfler/engine-order-analysis)

It is procedurally synthesised engine audio with sample-accurate RPM and torque
annotations, across eight capture configurations and three engines. Released
under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) —
attribution, non-commercial. Engine audio with labels you can actually trust is
hard to come by, so it seemed more useful shared than sitting on my drive. If
you end up building something with it, I'd be glad to hear about it — there's a
discussions tab on the Hugging Face page.

If you use the dataset, please cite it:

```bibtex
@dataset{doerfler_2025_procedural_engine_sounds,
  author       = {Doerfler, Robin},
  title        = {Procedural Engine Sounds Dataset},
  month        = {August},
  year         = 2025,
  publisher    = {Zenodo},
  version      = {1.0},
  doi          = {10.5281/zenodo.16883336},
  url          = {https://doi.org/10.5281/zenodo.16883336}
}
```

---

The page is plain HTML, CSS and JavaScript with no build step — GitHub Pages
serves it from `main`. Raleway is bundled under the SIL Open Font License, see
`assets/fonts/OFL.txt`.
