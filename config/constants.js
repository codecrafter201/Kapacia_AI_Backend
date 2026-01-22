'use strict'

    /*
    |--------------------------------------------------------------------------
    | Application Constants
    |--------------------------------------------------------------------------
    |
    | Documentation for application constants is crucial for maintaining and
    | understanding your codebase. Properly documented constants help developers
    | work more efficiently, reduce errors, and improve the overall quality of
    | your code. Below is an example of how you can document application 
    | constants effectively:
    */

//JWT
exports.JWT_EXPIRES_IN = '30d';

//All user roles
exports.USER_ROLE_ADMIN = 'admin';
exports.USER_ROLE_PLAYER = 'player';
exports.USER_ROLES = [
    exports.USER_ROLE_ADMIN,
    exports.USER_ROLE_PLAYER
]