// Class abstracting the machine being calibrated
class DuCalMachine 
{
    constructor(settings)
    {
        this.settings = settings;
        this.PopulateCommands();
        this.comms = new AsyncRequestor(req => OctoPrint.control.sendGcode(req), this.commands.Echo);

        this.IsReady = ko.observable(false);
        this.IsBusy = ko.observable(false);
        this.Geometry = ko.observable(undefined);
        
        this.BuildGeometryParsers();
    }

    BuildGeometryParsers()
    {
        this.geometryElementParsers = [
            new GeometryElementParser(this.commands.StepsPerUnit, this.commands.idsStepsPerUnit, (geometry, value) => geometry.StepsPerUnit = value, (geometry) => geometry.StepsPerUnit),
            new GeometryElementParser(this.commands.EndStopOffset, this.commands.idsEndStopOffset, (geometry, value) => geometry.EndStopOffset = value, (geometry) => geometry.EndStopOffset),
            new GeometryElementParser(this.commands.DeltaConfig, this.commands.idsTowerAngleOffset, (geometry, value) => geometry.TowerOffset = value, (geometry) => geometry.TowerOffset),
            new GeometryElementParser(this.commands.DeltaConfig, this.commands.idsRadiusHeightRod[0], (geometry, value) => geometry.Radius = value, (geometry) => geometry.Radius),
            new GeometryElementParser(this.commands.DeltaConfig, this.commands.idsRadiusHeightRod[1], (geometry, value) => geometry.Height = value, (geometry) => geometry.Height),
            new GeometryElementParser(this.commands.DeltaConfig, this.commands.idsRadiusHeightRod[2], (geometry, value) => geometry.DiagonalRod = value, (geometry) => geometry.DiagonalRod),
        ];
    }

    PopulateCommands()
    {
        this.commands = 
        {
            Init: ["G28","M204 T200", "G0 F12000"],
            Echo: "M118",
            Move: "G0",
            ProbeBed: "G30",
            FetchSettings: "M503",
            SaveSettings: "M500",
            StepsPerUnit: "M92",
            EndStopOffset: "M666",
            DeltaConfig: "M665",
            idsRadiusHeightRod: "RHL",
            idsTowerAngleOffset: "XYZ",
            idsEndStopOffset: "XYZ",         
            idsStepsPerUnit: "XYZ",
            //idsRadiusOffset="ABC",
            //idsRodLenOffset="IJK",
        }
    }

    ParseData(data)
    {
        this.comms.ReceiveResponse(data.logs);
        this.IsReady(data.state.flags.ready);
    }

    async Init()
    {
        await this.comms.Execute(this.commands.Init);
    }

    async GetGeometry()
    {        
        this.IsBusy(true);

        if(!this.Geometry())
        {
            await this.Init();
        }

        const response = await this.comms.Execute(this.commands.FetchSettings);

        var newGeometry = this.Geometry() ?? new DeltaGeometry() ;

        for (var i = 0; i < response.length; i++) {
            this.geometryElementParsers.forEach(element => element.ParseLog(newGeometry, response[i]));
        }

        this.Geometry(newGeometry);
        this.IsBusy(false);
        return newGeometry;
    }

    async SetGeometry(geometry)
    {
        this.IsBusy(true);
        await this.comms.Execute(this.geometryElementParsers.map(element => element.GetCommand(geometry)));
        await this.Init();
        const result = await this.GetGeometry();
        this.IsBusy(false);
        return result;
    }

    async ProbeBed(x, y) 
    {
        this.IsBusy(true);

        const commands = [
            `${this.commands.Move} Z5`, // safe height
            `${this.commands.Move} X${x} Y${y}`, // position
            `${this.commands.ProbeBed}` // probe
        ];

        const response = await this.comms.Execute(commands);

        const probePointRegex = /Bed X: (-?\d+\.?\d*) Y: (-?\d+\.?\d*) Z: (-?\d+\.?\d*)/;
        var match;
        var result = undefined;

        for (var i = 0; i < response.length; i++)
        {
            if (match = probePointRegex.exec(response[i]))
            {
                result = [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])];
                break;
            }
        }

        this.IsBusy(false);
        return result;

    }
}

class GeometryElementParser {
    constructor(command, element, setFunction, getFunction) {
        this.command = command;
        this.element = element && element.length > 0 ? Array.from(element) : new Array(0);
        this.setFunction = setFunction;
        this.getFunction = getFunction;
        this.regex = this.element.map(e => new RegExp(`${command} .*${e}(-?\\d+\\.?\\d*)`));
    }

    ParseLog(geometry, logLine) {
        if (this.element.length == 0) {
            return;
        }

        var match;

        if (this.element.length == 1) {
            if (match = this.regex[0].exec(logLine))
                this.setFunction(geometry, parseFloat(match[1]));
            return;
        }

        var result = this.getFunction(geometry);
        for (let i = 0; i < this.regex.length; i++) {
            if (match = this.regex[i].exec(logLine))
                result[i] = parseFloat(match[1])
        }

        this.setFunction(geometry, result);
    }

    GetCommand(geometry) {
        if (this.element.length == 0) {
            return;
        }

        if (this.element.length == 1) {
            return `${this.command} ${this.element}${this.getFunction(geometry)}`;
        }

        var value = this.getFunction(geometry);
        var result = this.command;
        for (let i = 0; i < this.element.length; i++) {
            result += ` ${this.element[i]}${value[i].toFixed(5)}`;
        }

        return result;
    }
}

class AsyncRequestor {
    constructor(sendRequestFunction, cmdEcho) {
        this.requestQueue = [];
        this.currentRequest = null;
        this.sendRequestFunction = sendRequestFunction;
        this.lastRequestId = 0;
        this.cmdEcho = cmdEcho
    }

    Execute(query)
    {
        const doneString = `DONE_${this.lastRequestId++}`;
        return this.Query([query, `${this.cmdEcho} ${doneString}`].flat(), (str) => str.includes(`Recv: ${doneString}`));
    }

    Query(query, isFinished, timeout) {
        return new Promise((resolve, reject) => this.Executor(query, isFinished, timeout, resolve, reject));
    }

    Executor(query, isFinished, timeout, resolve, reject) {
        this.requestQueue.push({ query: query, isFinished: isFinished, timeout: timeout, resolve: resolve, reject: reject, response: [], timeoutHandle: null , responseWatermark: 0});
        this.TryDequeue();
    }

    TryDequeue() {
        if (this.currentRequest === null && this.requestQueue.length > 0) {
            var request = this.requestQueue.shift();
            this.StartRequest(request);
        }
    }

    ReceiveResponse(data) {
        if (this.currentRequest !== null) {
            var request = this.currentRequest;
            request.response = request.response.concat(data);
            if (request.isFinished(data)) {
                this.EndRequest();
                request.resolve(request.response);
            }
        }
        else {
            this.TryDequeue();
        }
    }

    StartRequest(request) {
        this.currentRequest = request;
        this.sendRequestFunction(request.query);
        if (request.timeout)
            request.timeoutHandle = setTimeout(this.Timeout, request.timeout, request, this);
        request.watchdogHandle = setInterval(this.Watchdog, 3000, request, this);
    }

    EndRequest() {
        if (this.currentRequest.timeoutHandle)
            clearTimeout(this.currentRequest.timeoutHandle);
        if(this.currentRequest.watchdogHandle)
            clearInterval(this.currentRequest.watchdogHandle);
        this.currentRequest = null;
        this.TryDequeue();
    }

    Timeout(request, self) {
        if (self.currentRequest === request) {
            self.EndRequest();
            request.reject(request.response);
        }
    }

    Watchdog(request, self) {
        // are we still waiting on our request?
        if (self.currentRequest === request) 
            if(request.responseWatermark == request.response.length)
                self.sendRequestFunction(`${self.cmdEcho} PING`);
                else request.responseWatermark = request.response.length;
    }

}
