'use strict'

const nodemailer = require("nodemailer");

let config     = {};
config.mail = require("../../config/mail");
let o = {}

o.send = (to, subject = "", html = "") => {

	const transporter = nodemailer.createTransport({
        host: config.mail.host,
        port: config.mail.port,
        secure: (config.mail.port == 465) ? true : false, // true for 465, false for other ports
        auth: {
          user: config.mail.username, // generated ethereal user
          pass: config.mail.password, // generated ethereal password
        },
    });

    const mailOptions = {
        from: config.mail.username,
        to: to, 
        subject: subject,
        html: html
    }

    transporter.sendMail(mailOptions, function(err, res){
        if(err){
            console.log("Error:",err);
        }else{
            console.log("Success:",res);
        }
    });
}

module.exports = o;