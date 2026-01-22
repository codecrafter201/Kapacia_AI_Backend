'use strict'

module.exports = { 

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Stripe, Mailgun, SparkPost and others. This file provides a sane
    | default location for this type of information, allowing packages
    | to have a conventional place to find your various credentials.
    |
    */

    'facebook_token' : {
        'client_id' : 'CLIENT_ID',
        'client_secret' : 'CLIENT_SECRET'
    },

    'mailgun' : {
        'domain' : 'MAILGUN_DOMAIN',
        'secret' : 'MAILGUN_SECRET',
    },

    'ses' : {
        'key' : 'SES_KEY',
        'secret' : 'SES_SECRET',
        'region' : 'us-east-1',
    },

    'sparkpost' : {
        'secret' : 'SPARKPOST_SECRET',
    },

    'stripe' : {
        'model' : '',
        'key' : 'STRIPE_KEY',
        'secret' : 'STRIPE_SECRET',
    },

}
