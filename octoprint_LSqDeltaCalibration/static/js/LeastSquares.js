// Delta calibration script

var debug = false;

var firmware;
var normalise = true;

const degreesToRadians = Math.PI / 180.0;
const XAxis = 0;
const YAxis = 1;
const ZAxis = 2;
const AlphaTower = 0;
const BetaTower = 1;
const GammaTower = 2;


function fsquare(x) {
    return x * x;
}

class Matrix
{
    constructor(rows, cols) {
        this.data = [];
        for (var i = 0; i < rows; ++i) {
            var row = [];
            for (var j = 0; j < cols; ++j) {
                row.push(0.0);
            }
            this.data.push(row)
        }
    }

    SwapRows(i, j, numCols) {
        if (i != j) {
            for (var k = 0; k < numCols; ++k) {
                var temp = this.data[i][k];
                this.data[i][k] = this.data[j][k];
                this.data[j][k] = temp;
            }
        }
    }

    // Perform Gauus-Jordan elimination on a matrix with numRows rows and (njumRows + 1) columns
    GaussJordan(solution, numRows) {
        for (var i = 0; i < numRows; ++i) {
            // Swap the rows around for stable Gauss-Jordan elimination
            var vmax = Math.abs(this.data[i][i]);
            for (var j = i + 1; j < numRows; ++j) {
                var rmax = Math.abs(this.data[j][i]);
                if (rmax > vmax) {
                    this.SwapRows(i, j, numRows + 1);
                    vmax = rmax;
                }
            }

            // Use row i to eliminate the ith element from previous and subsequent rows
            var v = this.data[i][i];
            for (var j = 0; j < i; ++j) {
                var factor = this.data[j][i]/v;
                this.data[j][i] = 0.0;
                for (var k = i + 1; k <= numRows; ++k) {
                    this.data[j][k] -= this.data[i][k] * factor;
                }
            }

            for (var j = i + 1; j < numRows; ++j) {
                var factor = this.data[j][i]/v;
                this.data[j][i] = 0.0;
                for (var k = i + 1; k <= numRows; ++k) {
                    this.data[j][k] -= this.data[i][k] * factor;
                }
            }
        }

        for (var i = 0; i < numRows; ++i) {
            solution.push(this.data[i][numRows] / this.data[i][i]);
        }
    }

    Print(tag) {
        var rslt = tag + " {<br/>";
        for (var i = 0; i < this.data.length; ++i) {
            var row = this.data[i];
            rslt += (row == 0) ? '{' : ' ';
            for (var j = 0; j < row.length; ++j) {
                rslt += row[j].toFixed(4);
                if (j + 1 < row.length) {
                    rslt += ", ";
                }
            }
            rslt += '<br/>';
        }
        rslt += '}';
        return rslt;
    }
}


class DeltaGeometry
{
    constructor(diagonalRod = 0, radius = 0, height = 0, endStopOffset = [0,0,0], towerOffset = [0,0,0], stepsPerUnit = [0,0,0])
    {
        this.DiagonalRod = diagonalRod;
        this.Radius = radius;
        this.Height = height;
        this.EndStopOffset = endStopOffset.slice();
        this.TowerOffset = towerOffset.slice();
        this.StepsPerUnit = stepsPerUnit.slice();
        this.RecomputeGeometry();
    }
    
    Transform(machinePos, tower)
    {
        return machinePos[ZAxis] + Math.sqrt(this.D2 - fsquare(machinePos[XAxis] - this.towerPositions[tower, XAxis]) - fsquare(machinePos[YAxis] - this.towerPositions[tower,YAxis]));
    }

    // Inverse transform method, We only need the Z component of the result.
    InverseTransform(Ha, Hb, Hc)
    {
        var Fa = this.coreFa + fsquare(Ha);
        var Fb = this.coreFb + fsquare(Hb);
        var Fc = this.coreFc + fsquare(Hc);

        // Setup PQRSU such that x = -(S - uz)/P, y = (P - Rz)/Q
        var P = (this.Xbc * Fa) + (this.Xca * Fb) + (this.Xab * Fc);
        var S = (this.Ybc * Fa) + (this.Yca * Fb) + (this.Yab * Fc);

        var R = 2 * ((this.Xbc * Ha) + (this.Xca * Hb) + (this.Xab * Hc));
        var U = 2 * ((this.Ybc * Ha) + (this.Yca * Hb) + (this.Yab * Hc));

        var R2 = fsquare(R), U2 = fsquare(U);

        var A = U2 + R2 + this.Q2;
        var minusHalfB = S * U + P * R + Ha * this.Q2 + this.towerPositions[AlphaTower,XAxis] * U * this.Q - this.towerPositions[AlphaTower, YAxis] * R * this.Q;
        var C = fsquare(S + this.towerPositions[AlphaTower, XAxis] * this.Q) + fsquare(P - this.towerPositions[AlphaTower, YAxis] * this.Q) + (fsquare(Ha) - this.D2) * this.Q2;

        var rslt = (minusHalfB - Math.sqrt(fsquare(minusHalfB) - A * C)) / A;
        if (isNaN(rslt)) {
            debugger;
            throw "At least one probe point is not reachable. Please correct your delta radius, diagonal rod length, or probe coordniates.";
        }
        return rslt;
    }

    RecomputeGeometry()
    {
        this.towerPositions = [
            [-(this.Radius * Math.cos((30 + this.TowerOffset[AlphaTower]) * degreesToRadians)),
             -(this.Radius * Math.sin((30 + this.TowerOffset[AlphaTower]) * degreesToRadians))],
            [+(this.Radius * Math.cos((30 - this.TowerOffset[BetaTower]) * degreesToRadians)),
             -(this.Radius * Math.sin((30 - this.TowerOffset[BetaTower]) * degreesToRadians))],
            [-(this.Radius * Math.sin(this.TowerOffset[GammaTower] * degreesToRadians)),
             +(this.Radius * Math.cos(this.TowerOffset[GammaTower] * degreesToRadians))]];

        this.Xbc = this.towerPositions[GammaTower,XAxis] - this.towerPositions[BetaTower,XAxis];
        this.Xca = this.towerPositions[AlphaTower, XAxis] - this.towerPositions[GammaTower, XAxis];
        this.Xab = this.towerPositions[BetaTower,XAxis] - this.towerPositions[AlphaTower,XAxis];

        this.Ybc = this.towerPositions[GammaTower, YAxis] - this.towerPositions[BetaTower, YAxis];
        this.Yca = this.towerPositions[AlphaTower, YAxis] - this.towerPositions[GammaTower, YAxis];
        this.Yab = this.towerPositions[BetaTower, YAxis] - this.towerPositions[AlphaTower, YAxis];

        this.coreFa = fsquare(this.towerPositions[AlphaTower, XAxis] + fsquare(this.towerPositions[AlphaTower, YAxis]);
        this.coreFb = fsquare(this.towerPositions[BetaTower, XAxis] + fsquare(this.towerPositions[BetaTower, YAxis]);
        this.coreFc = fsquare(this.towerPositions[GammaTower, XAxis] + fsquare(this.towerPositions[GammaTower, YAxis]);
        this.Q = 2 * (this.Xca * this.Yab - this.Xab * this.Yca);
        this.Q2 = fsquare(this.Q);
        this.D2 = fsquare(this.DiagonalRod);

        // Calculate the base carriage height when the printer is homed.
        var tempHeight = this.DiagonalRod;		// any sensible height will do here, probably even zero
        this.homedCarriageHeight = this.Height + tempHeight - this.InverseTransform(tempHeight, tempHeight, tempHeight);
    }

    ComputeDerivative(deriv, ha, hb, hc)
    {
        var perturb = (deriv > 6 ? 0.002 : 0.2);			// perturbation amount in mm or degrees
        var haPerturb = 0;
        var hbPerturb = 0;
        var hcPerturb = 0;
        var hiParams = new DeltaGeometry(this.DiagonalRod, this.Radius, this.Height, this.EndStopOffset, this.TowerOffset, this.StepsPerUnit);
        var loParams = new DeltaGeometry(this.DiagonalRod, this.Radius, this.Height, this.EndStopOffset, this.TowerOffset, this.StepsPerUnit);
        switch (deriv) {
            case 0:
                haPerturb = perturb;
                break;

            case 1:
                hbPerturb = perturb;
                break;

            case 2:
                hcPerturb = perturb;
                break;

            case 3:
                hiParams.Radius += perturb;
                loParams.Radius -= perturb;
                break;

            case 4:
                hiParams.TowerOffset[XAxis] += perturb;
                loParams.TowerOffset[XAxis] -= perturb;
                break;

            case 5:
                hiParams.TowerOffset[YAxis] += perturb;
                loParams.TowerOffset[YAxis] -= perturb;
                break;

            case 6:
                hiParams.DiagonalRod += perturb;
                loParams.DiagonalRod -= perturb;
                break;

            case 7:
                haPerturb = (this.homedCarriageHeight - ha) * -perturb;
                break;

            case 8:
                hbPerturb = (this.homedCarriageHeight - hb) * -perturb;
                break;

            case 9:
                hcPerturb = (this.homedCarriageHeight - hc) * -perturb;
                break;

        }

        hiParams.RecomputeGeometry();
        loParams.RecomputeGeometry();

        var zHi = hiParams.InverseTransform(ha + haPerturb, hb + hbPerturb, hc + hcPerturb);
        var zLo = loParams.InverseTransform(ha - haPerturb, hb - hbPerturb, hc - hcPerturb);

        //debugger;
        return (zHi - zLo) / (2 * perturb);
    }

    // Make the average of the endstop adjustments zero, or make all emndstop corrections negative, without changing the individual homed carriage heights
    NormaliseEndstopAdjustments()
    {
        var eav = Math.min.apply(null, this.EndStopOffset);
        this.EndStopOffset = this.EndStopOffset.map(v => v - eav);
        this.Height += eav;
        this.homedCarriageHeight += eav;
    }

    // Perform 3, 4, 6 or 7-factor adjustment.
    // The input vector contains the following parameters in this order:
    //  X, Y and Z endstop adjustments
    //  If we are doing 4-factor adjustment, the next argument is the delta radius. Otherwise:
    //  X tower X position adjustment
    //  Y tower X position adjustment
    //  Z tower Y position adjustment
    //  Diagonal rod length adjustment
    Adjust(numFactors, v, norm)
    {
        var oldCarriageHeightA = this.homedCarriageHeight + this.EndStopOffset[XAxis];	// save for later

        // Update endstop adjustments
        this.EndStopOffset[XAxis] += v[0];
        this.EndStopOffset[YAxis] += v[1];
        this.EndStopOffset[ZAxis] += v[2];
        if (norm) {
            this.NormaliseEndstopAdjustments();
        }

        if (numFactors >= 4) {
            this.Radius += v[3];

            if (numFactors >= 6) {
                this.TowerOffset[XAxis] += v[4];
                this.TowerOffset[YAxis] += v[5];

                if (numFactors >= 7) {
                    this.DiagonalRod += v[6];

                    if (numFactors ==10) {
                        this.BeltStrech = [v[7], v[8], v[9]]
                    }
                }
            }
                       // debugger;
            this.RecomputeGeometry();
        }

        // Adjusting the diagonal and the tower positions affects the homed carriage height.
        // We need to adjust Height to allow for this, to get the change that was requested in the endstop corrections.
        var heightError = this.homedCarriageHeight + this.EndStopOffset[XAxis] - oldCarriageHeightA - v[0];
        this.Height -= heightError;
        this.homedCarriageHeight -= heightError;
    }
}

function DebugPrint(s) {
    if (debug) {
        console.log(s);
    }
}

function PrintVector(label, v) {
    var rslt = label + ": {";
    for (var i = 0; i < v.length; ++i) {
        rslt += v[i].toFixed(4);
        if (i + 1 != v.length) {
            rslt += ", ";
        }
    }
    rslt += "}";
    return rslt;
}

function DoDeltaCalibration(currentGeometry, probedPoints, numFactors ) {
    if (numFactors != 3 && numFactors != 4 && numFactors != 6 && numFactors != 7 && numFactors !=10) {
        throw "Error: " + numFactors + " factors requested but only 3, 4, 6 and 7, 10 supported";
    }
    var numPoints = probedPoints.length;

    if (numFactors > numPoints) {
        throw "Error: need at least as many points as factors you want to calibrate";
    }

    // Transform the probing points to motor endpoints and store them in a matrix, so that we can do multiple iterations using the same data
    var probeMotorPositions = new Matrix(numPoints, 3);
    var corrections = new Array(numPoints);
    var initialSumOfSquares = 0.0;
    for (var i = 0; i < numPoints; ++i) {
        corrections[i] = 0.0;
        var machinePos = [];
        machinePos.push(probedPoints[i][XAxis]);
        machinePos.push(probedPoints[i][YAxis]);
        machinePos.push(0.0);

        probeMotorPositions.data[i][0] = currentGeometry.Transform(machinePos, 0);
        probeMotorPositions.data[i][1] = currentGeometry.Transform(machinePos, 1);
        probeMotorPositions.data[i][2] = currentGeometry.Transform(machinePos, 2);

        initialSumOfSquares += fsquare(probedPoints[i][ZAxis]);
    }

    DebugPrint(probeMotorPositions.Print("Motor positions:"));
    
    // Do 1 or more Newton-Raphson iterations
    var iteration = 0;
    var expectedRmsError;
    for (;;) {
        // Build a Nx7 matrix of derivatives with respect to xa, xb, yc, za, zb, zc, diagonal.
        var derivativeMatrix = new Matrix(numPoints, numFactors);
        for (var i = 0; i < numPoints; ++i) {
            for (var j = 0; j < numFactors; ++j) {
                derivativeMatrix.data[i][j] =
                    currentGeometry.ComputeDerivative(j, probeMotorPositions.data[i][0], probeMotorPositions.data[i][1], probeMotorPositions.data[i][2]);
            }
        }

        DebugPrint(derivativeMatrix.Print("Derivative matrix:"));

        // Now build the normal equations for least squares fitting
        var normalMatrix = new Matrix(numFactors, numFactors + 1);
        for (var i = 0; i < numFactors; ++i) {
            for (var j = 0; j < numFactors; ++j) {
                var temp = 0; //derivativeMatrix.data[0][i] * derivativeMatrix.data[0][j];
                for (var k = 0; k < numPoints; ++k) {
                    temp += derivativeMatrix.data[k][i] * derivativeMatrix.data[k][j];
                }
                normalMatrix.data[i][j] = temp;
            }
            var temp = 0; //derivativeMatrix.data[0][i] * -(probedPoints[0][ZAxis] + corrections[0]);
            for (var k = 0; k < numPoints; ++k) {
                temp += derivativeMatrix.data[k][i] * -(probedPoints[k][ZAxis] + corrections[k]);
            }
            normalMatrix.data[i][numFactors] = temp;
        }

        DebugPrint(normalMatrix.Print("Normal matrix:"));

        var solution = [];
        normalMatrix.GaussJordan(solution, numFactors);
        
        for (var i = 0; i < numFactors; ++i) {
            if (isNaN(solution[i])) {
                throw "Unable to calculate corrections. Please make sure the bed probe points are all distinct.";
            }
        }

        DebugPrint(normalMatrix.Print("Solved matrix:"));

        if (debug) {
            DebugPrint(PrintVector("Solution", solution));

            // Calculate and display the residuals
            var residuals = [];
            for (var i = 0; i < numPoints; ++i) {
                var r = probedPoints[i][ZAxis];
                for (var j = 0; j < numFactors; ++j) {
                    r += solution[j] * derivativeMatrix.data[i][j];
                }
                residuals.push(r);
            }
            DebugPrint(PrintVector("Residuals", residuals));
        }

        currentGeometry.Adjust(numFactors, solution, normalise);

        // Calculate the expected probe heights using the new parameters
        {
            var expectedResiduals = new Array(numPoints);
            var sumOfSquares = 0.0;
            for (var i = 0; i < numPoints; ++i) {
                for (var axis = 0; axis < 3; ++axis) {
                    probeMotorPositions.data[i][axis] += solution[axis];
                }
                var newZ = currentGeometry.InverseTransform(probeMotorPositions.data[i][0], probeMotorPositions.data[i][1], probeMotorPositions.data[i][2]);
                corrections[i] = newZ;
                expectedResiduals[i] = probedPoints[i][ZAxis] + newZ;
                sumOfSquares += fsquare(expectedResiduals[i]);
            }

            expectedRmsError = Math.sqrt(sumOfSquares/numPoints);
            DebugPrint(PrintVector("Expected probe error", expectedResiduals));
            console.log("Iteration "+iteration+" rms " + expectedRmsError)
        }

        // Decide whether to do another iteration Two is slightly better than one, but three doesn't improve things.
        // Alternatively, we could stop when the expected RMS error is only slightly worse than the RMS of the residuals.
        ++iteration;
        if (iteration == 20) { break; }
    }

    return "Calibrated " + numFactors + " factors using " + numPoints + " points, deviation before " + Math.sqrt(initialSumOfSquares/numPoints)
            + " after " + expectedRmsError;
}



// End
