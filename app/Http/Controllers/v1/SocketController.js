'use strict'

/*
|--------------------------------------------------------------------------
| Socket Controller
|--------------------------------------------------------------------------
|
| This controller handles all sockets in the application
| The controller uses a trait to conveniently provide its functionality
| to your applications.
|
|--------------------------------------------------------------------------
| Listeners
|--------------------------------------------------------------------------
|
| * getJoinedRoomPlayers
| * getAllRooms
| * getJoinedRoom
| * receiveMsg
| * errors
|
*/

let o = {}

o.stats = function (socket) {

    socket.emit(Object.keys(io.sockets.connected).length);
}

module.exports = o;