/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/
import { Point3d, Vector3d } from "../../geometry3d/Point3dVector3d";
import { Checker } from "../Checker";
import { FrameBuilder } from "../../geometry3d/FrameBuilder";
import { AxisScaleSelect, Geometry } from "../../Geometry";
import { MatrixTests } from "./Point3dVector3d.test";
import { Range3d } from "../../geometry3d/Range";
import { Transform } from "../../geometry3d/Transform";
import { expect } from "chai";
import { Loop } from "../../curve/Loop";
import { Arc3d } from "../../curve/Arc3d";
import { LineString3d } from "../../curve/LineString3d";
import { LineSegment3d } from "../../curve/LineSegment3d";
import { AnyCurve } from "../../curve/CurveChain";
import { RegionOps } from "../../curve/RegionOps";
import { IModelJson } from "../../serialization/IModelJsonSchema";
import { prettyPrint } from "../testFunctions";
import { MomentData } from "../../geometry4d/MomentData";
import { GeometryCoreTestIO } from "../GeometryCoreTestIO";
import { GeometryQuery } from "../../curve/GeometryQuery";
/* tslint:disable:no-console */
describe("FrameBuilder", () => {

  it("HelloWorldA", () => {
    const ck = new Checker();
    const builder = new FrameBuilder();
    ck.testFalse(builder.hasOrigin, "frameBuilder.hasOrigin at start");

    for (const points of [
      [Point3d.create(0, 0, 0),
      Point3d.create(1, 0, 0),
      Point3d.create(0, 1, 0)],
      [Point3d.create(0, 0, 0),
      Point3d.create(1, 0, 0),
      Point3d.create(1, 1, 0)],
      [Point3d.create(1, 2, -1),
      Point3d.create(1, 3, 5),
      Point3d.create(-2, 1, 7)],
    ]) {
      builder.clear();
      const point0 = points[0];
      const point1 = points[1];
      const point2 = points[2];
      ck.testUndefined(builder.getValidatedFrame(), "frame in progress");
      const count0 = builder.announcePoint(point0);
      const count1 = builder.announcePoint(point0); // exercise the quick out.
      ck.testExactNumber(count0, count1, "repeat point ignored");
      ck.testTrue(builder.hasOrigin, "frameBuilder.hasOrigin with point");
      ck.testUndefined(builder.getValidatedFrame(), "no frame for minimal data");
      ck.testUndefined(builder.getValidatedFrame(), "frame in progress");

      builder.announcePoint(point1);
      ck.testUndefined(builder.getValidatedFrame(), "frame in progress");
      ck.testCoordinate(1, builder.savedVectorCount(), "expect 1 good vector");
      ck.testUndefined(builder.getValidatedFrame(), "frame in progress");

      builder.announcePoint(point2);
      ck.testUndefined(builder.getValidatedFrame(true), "frame in progress");
      const rFrame = builder.getValidatedFrame(false);
      if (ck.testPointer(rFrame, "expect right handed frame") && rFrame
        && ck.testBoolean(true, rFrame.matrix.isRigid(), "good frame")) {
        const inverse = rFrame.inverse();
        if (ck.testPointer(inverse, "invertible frame") && inverse) {
          const product = rFrame.multiplyTransformTransform(inverse);
          ck.testBoolean(true, product.isIdentity, "correct inverse");
          const q0 = inverse.multiplyPoint3d(point0);
          const q1 = inverse.multiplyPoint3d(point1);
          const q2 = inverse.multiplyPoint3d(point2);
          ck.testCoordinate(0.0, q0.x, "point0 is origin");
          ck.testCoordinate(0.0, q0.y, "point0 is origin");
          ck.testCoordinate(0.0, q0.z, "point0 is origin");
          ck.testCoordinate(0.0, q1.y, "point1 on x axis");
          ck.testCoordinate(0.0, q1.z, "point1 on x axis");
          ck.testCoordinate(0.0, q2.z, "point2 on xy plane");
          ck.testCoordinateOrder(0.0, q2.y, "point1 in positive y plane");
        }
      }
    }
    ck.checkpoint("FrameBuilder");
    expect(ck.getNumErrors()).equals(0);
  });
  it("HelloVectors", () => {
    const ck = new Checker();
    const builder = new FrameBuilder();
    ck.testFalse(builder.hasOrigin, "frameBuilder.hasOrigin at start");
    builder.announcePoint(Point3d.create(0, 1, 1));
    ck.testExactNumber(0, builder.savedVectorCount());
    ck.testExactNumber(0, builder.savedVectorCount());
    builder.announceVector(Vector3d.create(0, 0, 0));
    ck.testExactNumber(0, builder.savedVectorCount());

    // loop body assumes each set of points has 3 leading independent vectors
    for (const vectors of [
      [Vector3d.create(1, 0, 0),
      Vector3d.create(0, 1, 0),
      Vector3d.create(0, 0, 1)],
    ]) {
      builder.clear();
      const vector0 = vectors[0];
      const vector1 = vectors[1];
      const vector2 = vectors[2];
      builder.announce(Point3d.create(1, 2, 3));
      ck.testUndefined(builder.getValidatedFrame(), "frame in progress");
      builder.announce(vector0);
      ck.testExactNumber(1, builder.savedVectorCount());
      builder.announce(vector0);
      ck.testExactNumber(1, builder.savedVectorCount());

      ck.testExactNumber(2, builder.announceVector(vector1));
      ck.testExactNumber(2, builder.announceVector(vector1.plusScaled(vector0, 2.0)));

      ck.testExactNumber(3, builder.announceVector(vector2));

    }
    ck.checkpoint("FrameBuilder");
    expect(ck.getNumErrors()).equals(0);
  });
  it("HelloWorldB", () => {
    const ck = new Checker();

    const nullRangeLocalToWorld = FrameBuilder.createLocalToWorldTransformInRange(Range3d.createNull(), AxisScaleSelect.Unit, 0, 0, 0, 2.0);
    ck.testTransform(Transform.createIdentity(), nullRangeLocalToWorld, "frame in null range");

    for (const range of [Range3d.createXYZXYZ(1, 2, 3, 5, 7, 9)]
    ) {
      for (const select of [
        AxisScaleSelect.Unit,
        AxisScaleSelect.LongestRangeDirection,
        AxisScaleSelect.NonUniformRangeContainment]) {
        const localToWorld = FrameBuilder.createLocalToWorldTransformInRange(range, select, 0, 0, 0, 2.0);
        if (ck.testPointer(localToWorld) && localToWorld) {
          MatrixTests.checkProperties(ck,
            localToWorld.matrix,
            select === AxisScaleSelect.Unit,  // unit axes in range are identity
            select === AxisScaleSelect.Unit,  // and of course unitPerpendicular
            select === AxisScaleSelect.Unit,  // and of course rigid.
            true, // always invertible
            true);  // always diagonal
          const worldCorners = range.corners();
          worldCorners.push(range.fractionToPoint(0.5, 0.5, 0.5));
        }
      }
    }

    expect(ck.getNumErrors()).equals(0);
  });

  it("NonPlanarCurves", () => {
    const ck = new Checker();
    const allGeometry: GeometryQuery[] = [];
    const a = 10.0;
    let x0 = 0.0;
    const y0 = 0.0;
    for (const zz of [-1, 0, 1]) {
      const loop = new Loop();
      loop.tryAddChild(LineString3d.create(Point3d.create(0, 0, 0), Point3d.create(a, 0, 0), Point3d.create(a, a, 0), Point3d.create(0, a, 0)));
      loop.tryAddChild(Arc3d.createCircularStartMiddleEnd(
        Point3d.create(0, a, 0),
        Point3d.create(-a / 2, a / 2, zz),
        Point3d.create(0, 0, 0)));
      ck.testBoolean(
        Geometry.isSmallMetricDistance(zz), curvesToPlane(loop) !== undefined, "planarity test");

      const rawSums = RegionOps.computeXYAreaMoments(loop)!;
      console.log("curves", prettyPrint(IModelJson.Writer.toIModelJson(loop)));
      console.log("raw moment products", prettyPrint(rawSums.toJSON()));
      const principalMoments = MomentData.inertiaProductsToPrincipalAxes(rawSums.origin, rawSums.sums)!;
      console.log("inertia", prettyPrint(principalMoments.toJSON()));
      GeometryCoreTestIO.captureGeometry(allGeometry, loop, x0, y0, 0);
      GeometryCoreTestIO.showMomentData(allGeometry, rawSums, false, x0, y0, 0);
      x0 += 2.0 * a;

    }
    ck.testUndefined(curvesToPlane(LineSegment3d.createXYZXYZ(1, 2, 4, 5, 2, 3)));
    GeometryCoreTestIO.saveGeometry(allGeometry, "FrameBuilder", "NonPlanarCurves");
    expect(ck.getNumErrors()).equals(0);
  });

});

/** test if a curve collection is planar within tolerance.
 * * The plane considered is as returned by FrameBuilder.createRightHandedFrame ()
 */
function curvesToPlane(curves: AnyCurve, tolerance: number = Geometry.smallMetricDistance): Transform | undefined {
  const localToWorldA = FrameBuilder.createRightHandedFrame(undefined, curves)!;
  if (!localToWorldA)
    return undefined;
  const worldToLocalA = localToWorldA.inverse()!;
  const rangeA = curves.range(worldToLocalA);
  if (rangeA.zLength() <= tolerance)
    return localToWorldA;
  return undefined;
}