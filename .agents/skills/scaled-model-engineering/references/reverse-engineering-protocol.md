# Reverse Engineering Protocol

## Capture

- Clean surfaces and mitigate reflective, transparent, or black materials when optical scanning requires it.
- Choose structured light for controlled detail, laser triangulation for precision over varied surfaces, photogrammetry for large assets, and CT when internal geometry justifies it.
- Capture oriented normals, maintain 30%-50% overlap, stabilize the subject, and inspect coverage before teardown.
- Establish datum planes and axes before registration.

## Reconstruction

1. Preserve raw data and provenance.
2. Remove outliers without smoothing away edges.
3. Register segments and record ICP residuals.
4. Use Poisson reconstruction only when oriented points and watertight output fit the use case.
5. Select and record adaptive octree depth.
6. Decimate adaptively while protecting boundaries, curvature, openings, and controls.

## Parametric Recovery and QA

- Extract planes, cylinders, spheres, axes, profiles, and repeated patterns.
- Build constrained sketches and feature history where editable CAD is required.
- Model intended parallelism, concentricity, symmetry, and nominal dimensions instead of wear.
- Compare results to capture data with signed deviation maps and summary statistics.
- Record hardware, reconstruction settings, coordinate system, tool versions, and manual decisions.
