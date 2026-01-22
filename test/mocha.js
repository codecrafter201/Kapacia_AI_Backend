process.env.NODE_ENV = 'test';
let baseURL = "http://localhost:3000";
let socketURL = "ws://localhost:3000";
let server = require("../server");

let chai = require('chai');
let chaiHttp = require('chai-http');
chai.use(chaiHttp);

let mongoose = require("mongoose");
let User = mongoose.model("User");

let client_io = require("socket.io-client");

let token = "";

describe("=========== Users ===========", () => {

    describe("Remove Test User initially if existed", () => {
        
        it("It should remove test user on init", (done) => {
            
            User.deleteOne({ email: "test@test.com" }, function(err, newUser){
                if(!err){
                    done();
                }
            })
        });
    })

    describe("/POST Signup", () => {
        let user = {
            username: "Test1",
            email: "test@test.com",
            password: "CHmod512"
        };
        it('Test Signup API', (done) => {
            chai.request(baseURL)
                .post('/api/v1/user/signup')
                .send(user)
                .end((err, res) => {
                    chai.expect(res).to.have.status(201);
                    chai.expect(res.body).to.be.a('object');
                    chai.expect(res.body.data).to.be.have.property('_id');
                    chai.expect(res.body.data).to.be.have.property('username');
                    chai.expect(res.body.data).to.be.have.property('email').to.equal("test@test.com");
                    chai.expect(res.body.data).to.be.have.property('phone');
                    chai.expect(res.body.data).to.be.have.property('address');
                    chai.expect(res.body.data).to.be.have.property('image');
                    chai.expect(res.body.data).to.be.have.property('level');
                    chai.expect(res.body.data).to.be.have.property('roles').to.be.an("array");
                    chai.expect(res.body.data).to.not.have.property('password');
                done();
                });
        })
    })

    describe("/POST Login", () => {
        let user = {
            email: "test@test.com",
            password: "CHmod512"
        };
        it('Test Login API', (done) => {
            chai.request(baseURL)
                .post('/api/v1/user/login')
                .send(user)
                .end((err, res) => {
                    token = res.body.data.token;
                    chai.expect(res).to.have.status(200);
                    chai.expect(res.body).to.be.a('object');
                    chai.expect(res.body.data).to.be.have.property('_id');
                    chai.expect(res.body.data).to.be.have.property('username');
                    chai.expect(res.body.data).to.be.have.property('email').to.equal("test@test.com");
                    chai.expect(res.body.data).to.be.have.property('phone');
                    chai.expect(res.body.data).to.be.have.property('address');
                    chai.expect(res.body.data).to.be.have.property('image');
                    chai.expect(res.body.data).to.be.have.property('level');
                    chai.expect(res.body.data).to.be.have.property('token');
                    chai.expect(res.body.data).to.be.have.property('roles').to.be.an("array");
                    chai.expect(res.body.data).to.not.have.property('password');
                done();
                });
        })
    })

    describe("/GET / (Get Profile)", () => {
        it('Test Get Profile API', (done) => {
            chai.request(baseURL)
                .get('/api/v1/user/')
                .set('x-access-token',token)
                .end((err, res) => {
                    chai.expect(res).to.have.status(200);
                    chai.expect(res.body).to.be.a('object');
                    chai.expect(res.body.data).to.be.have.property('_id');
                    chai.expect(res.body.data).to.be.have.property('username');
                    chai.expect(res.body.data).to.be.have.property('email').to.equal("test@test.com");
                    chai.expect(res.body.data).to.be.have.property('phone');
                    chai.expect(res.body.data).to.be.have.property('address');
                    chai.expect(res.body.data).to.be.have.property('image');
                    chai.expect(res.body.data).to.be.have.property('level');
                    chai.expect(res.body.data).to.be.have.property('roles').to.be.an("array");
                    chai.expect(res.body.data).to.not.have.property('password');
                done();
                });
        })
    })

    describe("/PUT / (Update Profile)", () => {
        let body = {
            username: "Test User Updated",
            address: "Address1",
            phone: "090078601"
        };
        it('Test Update Profile API', (done) => {
            chai.request(baseURL)
                .put('/api/v1/user')
                .set('x-access-token', token)
                .send(body)
                .end((err, res) => {
                    chai.expect(res).to.have.status(200);
                    chai.expect(res.body).to.be.a('object');
                    chai.expect(res.body.data).to.be.have.property('_id');
                    chai.expect(res.body.data).to.be.have.property('username').to.equal("Test User Updated");
                    chai.expect(res.body.data).to.be.have.property('email').to.equal("test@test.com");
                    chai.expect(res.body.data).to.be.have.property('phone').to.equal("090078601");
                    chai.expect(res.body.data).to.be.have.property('address').to.equal("Address1");
                    chai.expect(res.body.data).to.be.have.property('image');
                    chai.expect(res.body.data).to.be.have.property('level');
                    chai.expect(res.body.data).to.be.have.property('roles').to.be.an("array");
                    chai.expect(res.body.data).to.not.have.property('password');
                done();
                });
        })
    })
});


describe("=========== Sockets ===========", () => {
    let socket;
    describe(" (connect) ", () => {

        it('Connected to socket', (done) => {
            
            socket = client_io.connect(socketURL,{
                query: {token: token}
            })
            
            socket.on('connect', function(){
                done();
            })
 
        });
    })

    describe(" (disconnect) ", () => {

        it("Disconnected to the server", (done) => {

            socket.on('disconnect', function(){
                done();
            })
            socket.disconnect();
        });
    })
});